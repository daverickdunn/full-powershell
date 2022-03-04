import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { debug } from 'debug';
import os from 'os';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { catchError, concatMap, filter, map, share, take, tap, timeout } from 'rxjs/operators';
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
    pid: number
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
    timeout?: number // milliseconds
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

    private out$: Observable<PowerShellStreams>;
    // private err$: Subject<any> = new Subject();

    private delimit_head = 'F0ZU7Wm1p4'; // random string
    private delimit_tail = 'AdBmCXEdsB'; // random string

    private queue: Command[] = [];
    private tick$ = new Subject<void>();

    private tmp_dir: string = '';
    /* istanbul ignore next */
    private exe_path: string = (os.platform() === 'win32' ? 'powershell' : 'pwsh');
    private timeout = 600000; // 10 minutes

    constructor(options?: PowerShellOptions) {

        if (!!options) this.setOptions(options);

        log.info('[>] new instance');
        log.info('[>] tmp_dir: %s', this.tmp_dir);
        log.info('[>] exe_path: %s', this.exe_path);
        log.info('[>] timeout: %s', this.timeout);

        this.spawnChildProcess();
        this.initReaders();
        this.initQueue();
    }

    setOptions(options: PowerShellOptions) {
        if (options.tmp_dir) this.tmp_dir = options.tmp_dir;
        if (options.exe_path) this.exe_path = options.exe_path;
        if (options.timeout) this.timeout = options.timeout;
    }

    private spawnChildProcess() {

        log.info('[>] spawn child process');

        const args = ['-NoLogo', '-NoExit', '-Command', '-'];

        this.powershell = spawn(this.exe_path, args, { stdio: 'pipe' });

        log.info('[>] pid: %s', this.powershell.pid);

        this.powershell.on('exit', () => {
            if (!this.powershell.killed) {
                log.info('[>] child process closed itself');
            }
        });

        // this.powershell.on('close', () => console.log('[fps] close'));
        // this.powershell.on('data', () => console.log('[fps] data'));
        // this.powershell.on('error', () => console.log('[fps] error'));

        this.powershell.stdin.setDefaultEncoding('utf8');
        this.powershell.stdout.setEncoding('utf8');
        this.powershell.stderr.setEncoding('utf8');

        this.stdin = this.powershell.stdin;
        this.stdout = this.powershell.stdout;
        this.stderr = this.powershell.stderr;
    }

    private initReaders() {

        log.info('[>] init readers');

        const read_out = new BufferReader(this.delimit_head, this.delimit_tail);
        const read_err = new BufferReader(this.delimit_head, this.delimit_tail);
        this.stdout.pipe(read_out);
        this.stderr.pipe(read_err);

        this.out$ = read_out.subject.pipe(
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

                return {
                    success,
                    error,
                    warning,
                    verbose,
                    debug,
                    info,
                };
            }),
            share() // prevents duplicate calls
        );

    }

    private reset() {
        log.info('[>] reset');
        this.powershell.kill();
        this.spawnChildProcess();
        this.initReaders();
        this.initQueue();
    }

    private initQueue() {

        log.info('[>] init queue');

        let ready = false;

        const sub = this.tick$
            .pipe(
                tap(() => log.info('[>] tick queued: %s ready: %s', this.queue.length, ready)),
                filter(() => ready), // if ready
                map(() => this.queue.shift()), // next command
                filter(Boolean), // if there was a command
                tap((c) => log.info('[>] shifted', c.command)),
                tap(() => ready = false),
                concatMap(command => {

                    if (this.powershell.pid !== command.pid) {
                        const err = new Error(`pid has changed since command was queued. was: ${command.pid} now: ${this.powershell.pid}`);
                        log.error(err.message);
                        sub.unsubscribe();
                        this.reset();
                        command.subject.error(err);
                        throw err
                    }

                    // this.err$.subscribe(err => {
                    //     log.info(err.message);
                    //     sub.unsubscribe();
                    //     this.reset();
                    //     command.subject.error(err);
                    // })

                    log.info('[>] executing: %s', command.command)
                    this.stdin.write(Buffer.from(command.wrapped));

                    return this.out$.pipe(
                        take(1),
                        timeout(this.timeout),
                        catchError(err => {
                            log.error('[X] error in pipe: %O', err)
                            sub.unsubscribe();
                            this.reset();
                            command.subject.error(err);
                            throw err
                        }),
                        tap(res => {
                            log.info('[>] complete: %s', command.command)
                            command.subject.next(res);
                            command.subject.complete();
                            ready = true;
                            this.tick$.next();
                        }),
                    );
                })
            )
            .subscribe({
                error: err => {
                    log.error('[X] error at queue %O', err)
                    this.reset();
                }
            })

        log.info('[>] %s pending', this.queue.length)
        ready = true;
        this.tick$.next();

    }

    public call(command: string, format: Format = 'json') {

        log.info('[>] command: %s', command)
        log.info('[>] format: %s', format)
        log.info('[>] pid: %s', this.powershell.pid)

        const subject = new SubjectWithPromise<PowerShellStreams>();

        const wrapped = wrap(
            command,
            this.delimit_head,
            this.delimit_tail,
            format,
            this.tmp_dir
        );

        this.queue.push({
            command: command,
            wrapped: wrapped,
            subject: subject,
            pid: this.powershell.pid || 0
        })

        this.tick$.next();

        return subject;
    }

    public destroy() {
        log.info('[>] destroy called')
        return this.powershell.kill();
    }
}