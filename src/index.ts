import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { debug } from 'debug';
import os from 'os';
import { firstValueFrom, Observable, of, Subject } from 'rxjs';
import { catchError, concatMap, filter, map, switchMap, take, tap, timeout } from 'rxjs/operators';
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

        this.init();
    }

    setOptions(options: PowerShellOptions) {
        if (options.tmp_dir) this.tmp_dir = options.tmp_dir;
        if (options.exe_path) this.exe_path = options.exe_path;
        if (options.timeout) this.timeout = options.timeout;
    }

    private init() {
        log.info('[>] init');
        this.initProcess();
        this.initReaders();
        this.initQueue();
    }

    private initProcess() {

        log.info('[>] init process');

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
            })
        );

    }

    private initQueue() {

        log.info('[>] init queue');

        // invokes a command
        // enforces timeout
        // errors calling subject
        const invoke = (command: Command) => {
            log.info('[>] invoking: %s', command.command)
            this.stdin.write(Buffer.from(command.wrapped))
            return this.out$.pipe(
                take(1),
                timeout(this.timeout),
                map(result => ({ command, result })),
                catchError(err => {
                    log.error('[X] error in pipe: %O', err)
                    let error = err;
                    if (error.name === 'TimeoutError') {
                        error = new Error(`Command timed out after ${this.timeout} milliseconds. Check the full-powershell docs for more information.`)
                    }
                    command.subject.error(error);
                    throw error
                })
            );
        }

        // selects next command from queue
        const handler = () => {
            log.info('[>] %s pending', this.queue.length)
            return of(this.queue.shift() as Command)
                .pipe(
                    filter(command => command !== undefined),
                    switchMap(command => invoke(command as Command))
                )
        }

        // subscribes to tick to trigger check for next command
        // concatMaps command handler to enforce order
        let sub = this.tick$.pipe(
            tap(_ => log.info('[>] tick')),
            concatMap(_ => handler())
        )
            .subscribe({
                next: ({ command, result }) => {
                    log.info('[>] complete: %s', command.command)
                    command.subject.next(result); // emit from subject returned by call()
                    command.subject.complete(); // complete subject returned by call()
                    this.tick$.next(); // check for next command in queue
                },
                error: err => {
                    log.info('[>] error.......... %O', err)
                    sub.unsubscribe(); // clean up this observable chain
                    this.destroy(); // kill old process
                    this.init(); // start a new process
                }
            })

        this.tick$.next();
    }

    public call(command: string, format: Format = 'json') {

        log.info('[>] command: %s', command)
        log.info('[>] format: %s', format)
        log.info('[>] pid: %s', this.powershell.pid)

        // subject to be returned form this method
        const subject = new SubjectWithPromise<PowerShellStreams>();

        // wrap the command in the serialisation script
        const wrapped: string = wrap(
            command,
            this.delimit_head,
            this.delimit_tail,
            format,
            this.tmp_dir
        );

        // queue the command context
        this.queue.push({
            command: command,
            wrapped: wrapped,
            subject: subject,
            pid: this.powershell.pid || 0
        })

        // attempt to execute the command after this function has returned the subject
        queueMicrotask(() => this.tick$.next())

        // return the subject for this command
        return subject
    }

    public destroy() {
        log.info('[>] destroy called')
        return this.powershell.kill();
    }
}