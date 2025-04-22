import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { existsSync, unlinkSync } from 'fs';
import {
    Observable,
    Subject,
    map
} from 'rxjs';
import { Readable, Writable } from 'stream';
import { Format, wrap } from './wrapper';

interface RawStreams {
    success: string;
    error: string;
    warning: string;
    verbose: string;
    debug: string;
    info: string;
    format: Format;
}

export interface PowerShellStreams {
    success: Array<any>;
    error: Array<any>;
    warning: Array<any>;
    verbose: Array<any>;
    debug: Array<any>;
    info: Array<any>;
}

function parseStream(stream: string, format: Format) {
    if (format != null) {
        return JSON.parse(stream);
    } else {
        return stream;
    }
}

class BufferReader extends Writable {

    public subject = new Subject<string>();
    private buffer: Buffer = Buffer.from('');
    private head: Buffer;
    private tail: Buffer;

    constructor(head: string, tail: string) {
        super();
        this.head = Buffer.from(head);
        this.tail = Buffer.from(tail);
    }

    extract(): Buffer {
        const head_idx = this.buffer.indexOf(this.head);
        const tail_idx = this.buffer.indexOf(this.tail);
        const data = this.buffer.subarray(head_idx + this.head.length, tail_idx);
        this.buffer = this.buffer.subarray(tail_idx + this.tail.length);
        return data;
    }

    _write(chunk: Buffer, encoding: string, callback: Function) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        while (this.buffer.includes(this.tail)) {
            const extracted = this.extract();
            this.subject.next(extracted.toString('utf8'));
        }
        callback();
    }
}

export class PowerShellProcess {

    private child: ChildProcessWithoutNullStreams;
    private stdin: Writable;
    private stdout: Readable;
    private stderr: Readable;
    private read_out: BufferReader;
    private read_err: BufferReader;
    private readonly delimit_head = 'F0ZU7Wm1p4'; // random string
    private readonly delimit_tail = 'AdBmCXEdsB'; // random string
    private readonly out_verbose: string;
    private readonly out_debug: string;
    private closed$ = new Subject<{ code: number | null, signal: NodeJS.Signals | null }>();

    public readonly pid: number;

    constructor(
        private exe_path = 'powershell',
        private tmp_dir: string = ''
    ) {

        const args = ['-NoLogo', '-NoExit', '-Command', '-'];
        this.child = spawn(this.exe_path, args, { stdio: 'pipe' });

        this.pid = this.child.pid as number;

        this.child.stdin.setDefaultEncoding('utf8');
        this.child.stdout.setEncoding('utf8');
        this.child.stderr.setEncoding('utf8');

        this.stdin = this.child.stdin;
        this.stdout = this.child.stdout;
        this.stderr = this.child.stderr;

        const prefix = randomBytes(8).toString('hex');
        this.out_verbose = `${this.tmp_dir}${prefix}_fps_verbose.tmp`;
        this.out_debug = `${this.tmp_dir}${prefix}_fps_debug.tmp`;

        this.child.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
            this.removeTempFile(this.out_verbose);
            this.removeTempFile(this.out_debug);
            this.closed$.next({ code, signal });
            this.closed$.complete();
        });

        this.read_out = new BufferReader(this.delimit_head, this.delimit_tail);
        this.read_err = new BufferReader(this.delimit_head, this.delimit_tail);

        this.stdout.pipe(this.read_out);
        this.stderr.pipe(this.read_err);

    }

    public get listen(): Observable<PowerShellStreams> {
        return this.read_out.subject.pipe(
            map((res: string) => {
                const result = JSON.parse(res).result as RawStreams;
                const success = parseStream(result.success, result.format);
                const error = parseStream(result.error, 'json');
                const warning = parseStream(result.warning, 'json');
                const verbose = parseStream(result.verbose, 'string');
                const debug = parseStream(result.debug, 'string');
                const info = parseStream(result.info, 'json');

                return {
                    success,
                    error,
                    warning,
                    verbose,
                    debug,
                    info,
                };
            })
        );
    }

    public write(command: string, format: Format = 'json', verbose: boolean = false, debug: boolean = false) {

        // wrap the command in the serialisation script
        const wrapped: string = wrap({
            command,
            delimit_head: this.delimit_head,
            delimit_tail: this.delimit_tail,
            out_verbose: this.out_verbose,
            out_debug: this.out_debug,
            format,
            verbose,
            debug
        });

        return this.stdin.write(Buffer.from(wrapped), (error: Error | null | undefined) => {
            if (error) {
                console.error(`Error writing to PowerShell stdin (pid: ${this.pid}):`, error);
            }
        });
    }

    get closed(): Observable<{ code: number | null, signal: NodeJS.Signals | null }> {
        return this.closed$
    }

    private removeTempFile(file: string) {
        if (existsSync(file)) {
            unlinkSync(file);
        }
    }

}