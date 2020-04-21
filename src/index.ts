import os from 'os';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { Observable, Subject } from 'rxjs';
import { Readable, Writable } from 'stream';
import { wrap, Format } from './wrapper';

interface PowerShellStreams {
    success: string | Array<string>;
    error: string;
    warning: string;
    info: string;
    format: Format;
}

function formatSuccessOutput(streams: PowerShellStreams){
    if (streams.format === 'json'){
        return JSON.parse(streams.success as string)
    }
    if (streams.format === 'string'){
        return streams.success
    }
    if (streams.format === 'csv'){
        return streams.success
    }
    if (streams.format === 'html'){
        return streams.success
    }
}

function replace(buffer: Buffer, a: Buffer, b: Buffer) {
    const idx = buffer.indexOf(a);
    if (idx === -1) return buffer;
    const before = buffer.slice(0, idx);
    const after = buffer.slice(idx + a.length);
    const len = before.length + b.length + after.length;
    return Buffer.concat([before, b, after], len);
}

class BufferReader extends Writable {
    public subject = new Subject<string>();
    private chunks: Array<Buffer> = [];
    private eoi: Buffer;

    constructor(eoi: string) {
        super();
        this.eoi = Buffer.from(eoi);
    }

    _write(chunk: Buffer, encoding: string, callback: Function) {
        if (chunk.includes(this.eoi)) {
            let cleaned = replace(chunk, this.eoi, Buffer.from(''));
            this.chunks.push(cleaned);
            this.subject.next(Buffer.concat(this.chunks).toString('utf8'));
            this.chunks = [];
            callback();
        } else {
            this.chunks.push(chunk);
            callback();
        }
    }
}

function write(stream: Writable, string: string) {
    return new Observable((sub) => {
        let success = stream.write(Buffer.from(string));
        if (success) {
            sub.next(string);
        } else {
            stream.once('drain', () => sub.next(string));
        }
    });
}

export class PowerShell {
    public $success = new Subject<string>();
    public $error = new Subject<string>();
    public $warning = new Subject<string>();
    public $verbose = new Subject<string>();
    public $debug = new Subject<string>();
    public $info = new Subject<string>();

    private powershell: ChildProcessWithoutNullStreams;
    private stdin: Writable;
    private stdout: Readable;
    private stderr: Readable;
    private EOI = 'F0ZU7Wm1p4';

    constructor() {
        const args = ['-NoLogo', '-NoExit', '-Command', '-'];
        const exe = os.platform() === 'win32' ? 'powershell' : 'pwsh';

        this.powershell = spawn(exe, args, { stdio: 'pipe' });

        if (!this.powershell.pid) {
            throw new Error('could not start child process');
        }

        this.powershell.once('error', () => {
            throw new Error('child process threw an error');
        });

        this.powershell.stdin.setDefaultEncoding('utf8');
        this.powershell.stdout.setEncoding('utf8');
        this.powershell.stderr.setEncoding('utf8');

        this.stdin = this.powershell.stdin;
        this.stdout = this.powershell.stdout;
        this.stderr = this.powershell.stderr;

        let read_out = new BufferReader(this.EOI);
        let read_err = new BufferReader(this.EOI);

        this.stdout.pipe(read_out);
        this.stderr.pipe(read_err);

        read_out.subject.subscribe((res) => {
            let result = JSON.parse(res).result as PowerShellStreams;
            let { error, warning, info } = result;
            let success = formatSuccessOutput(result);
            for (let item of success) this.$success.next(item);
            for (let item of error) this.$error.next(item);
            for (let item of warning) this.$warning.next(item);
            for (let item of info) this.$info.next(item);
        });

        read_err.subject.subscribe((res) => {
            this.$error.next(res);
        });
    }

    call(string: string, format: Format = 'json'): void {
        write(this.stdin, wrap(string, this.EOI, format)).subscribe();
    }

    destroy() {
        this.powershell.kill();
    }
}