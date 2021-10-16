import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { debug } from 'debug';
import os from 'os';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { concatMap, map, take, tap } from 'rxjs/operators';
import { Readable, Writable } from 'stream';
import { Format, wrap } from './wrapper';

const log = {
    info: debug('fps:info'),
    error: debug('fps:error')
}

interface Command {
    command: string;
    wrapped: string;
    subject: Subject<PowerShellStreams>;
}

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

class SubjectWithPromise<T> extends Subject<T> {
    async promise() {
        return firstValueFrom(this);
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
        let head_idx = this.buffer.indexOf(this.head);
        let tail_idx = this.buffer.indexOf(this.tail);
        let data = this.buffer.slice(head_idx + this.head.length, tail_idx);
        this.buffer = this.buffer.slice(tail_idx + this.tail.length);
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

interface PowerShellOptions {
    tmp_dir?: string
    exe_path?: string
}

export class PowerShell {
    public success$ = new Subject<Array<any>>();
    public error$ = new Subject<Array<any>>();
    public warning$ = new Subject<Array<any>>();
    public verbose$ = new Subject<Array<any>>();
    public debug$ = new Subject<Array<any>>();
    public info$ = new Subject<Array<any>>();

    private powershell: ChildProcessWithoutNullStreams;
    private stdin: Writable;
    private stdout: Readable;
    private stderr: Readable;

    private read_out: BufferReader;
    private read_err: BufferReader;

    private delimit_head = 'F0ZU7Wm1p4'; // random string
    private delimit_tail = 'AdBmCXEdsB'; // random string

    private command_queue$ = new Subject<Command>();

    private tmp_dir: string = '';
    private exe_path: string = (os.platform() === 'win32' ? 'powershell' : 'pwsh');

    constructor(options?: PowerShellOptions) {
        if (!!options) this.setOptions(options);
        this.initPowerShell();
        this.initReaders();
        this.initQueue();
    }

    setOptions(options: PowerShellOptions) {
        if (options.tmp_dir) this.tmp_dir = options.tmp_dir;
        if (options.exe_path) this.exe_path = options.exe_path;
    }

    private initPowerShell() {
        const args = ['-NoLogo', '-NoExit', '-Command', '-'];

        this.powershell = spawn(this.exe_path, args, { stdio: 'pipe' });

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
    }

    private initReaders() {
        this.read_out = new BufferReader(this.delimit_head, this.delimit_tail);
        this.read_err = new BufferReader(this.delimit_head, this.delimit_tail);
        this.stdout.pipe(this.read_out);
        this.stderr.pipe(this.read_err);
        this.read_err.subject.subscribe((res) => {
            log.error('read_err: %O', res)
            this.error$.next([res]);
        });
    }

    private initQueue() {
        this.command_queue$
            .pipe(
                tap(command => log.info('invoking command: %O', command.command)),
                concatMap(command => this._call(command.wrapped).pipe(
                    map(result => ({ ...command, result }))
                )),
                tap(command => log.info('command complete: %O', command.command)),
            )
            .subscribe(res => {
                res.subject.next(res.result);
                res.subject.complete();
            });
    }

    private _call(wrapped: string): Observable<PowerShellStreams> {

        this.stdin.write(Buffer.from(wrapped)); // send command to powershell

        return this.read_out.subject.pipe(
            take(1),
            map((res: string) => {
                let result = JSON.parse(res).result as RawStreams;
                let success = parseStream(result.success, result.format);
                let error = parseStream(result.error, 'json');
                let warning = parseStream(result.warning, 'json');
                let verbose = parseStream(result.verbose, 'string');
                let debug = parseStream(result.debug, 'string');
                let info = parseStream(result.info, 'json');

                if (success.length > 0) this.success$.next(success);
                if (error.length > 0) this.error$.next(error);
                if (warning.length > 0) this.warning$.next(warning);
                if (verbose.length > 0) this.verbose$.next(verbose);
                if (debug.length > 0) this.debug$.next(debug);
                if (info.length > 0) this.info$.next(info);

                let streams: PowerShellStreams = {
                    success,
                    error,
                    warning,
                    verbose,
                    debug,
                    info,
                };

                return streams;
            })
        );
    }

    public call(command: string, format: Format = 'json') {

        log.info('received command: %O', command)

        const subject = new SubjectWithPromise<PowerShellStreams>();

        const wrapped = wrap(
            command,
            this.delimit_head,
            this.delimit_tail,
            format,
            this.tmp_dir
        );

        const queued: Command = {
            command: command,
            wrapped: wrapped,
            subject: subject,
        }

        this.command_queue$.next(queued);

        return subject;
    }

    public destroy() {
        return this.powershell.kill();
    }
}