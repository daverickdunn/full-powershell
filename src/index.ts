import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { debug } from 'debug';
import { existsSync, unlinkSync } from 'fs';
import os from 'os';
import {
    BehaviorSubject,
    Observable,
    Subject,
    catchError,
    combineLatest,
    concatMap,
    delay,
    filter,
    first,
    firstValueFrom,
    from,
    map,
    of,
    race,
    skipWhile,
    switchMap,
    take,
    takeUntil,
    tap,
    throwError,
    timeout
} from 'rxjs';
import { Readable, Writable } from 'stream';
import { Format, wrap } from './wrapper';

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
    verbose?: boolean
    debug?: boolean
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

    private delimit_head = 'F0ZU7Wm1p4'; // random string
    private delimit_tail = 'AdBmCXEdsB'; // random string
    private out_verbose: string;
    private out_debug: string;

    private queue: Command[] = [];
    private tick$: Subject<string>;
    private isRunning = false;

    private respawning$: BehaviorSubject<boolean>;
    private respawned$: SubjectWithPromise<boolean>;

    private closing$: BehaviorSubject<boolean>;
    private closed$: SubjectWithPromise<boolean>;

    private subscriptions: Array<Subject<any>> = [];
    private tmp_dir: string = '';
    /* istanbul ignore next */
    private exe_path: string = (os.platform() === 'win32' ? 'powershell' : 'pwsh');
    private timeout = 600000; // 10 minutes

    private verbose: boolean = true;
    private debug: boolean = true;

    constructor(options?: PowerShellOptions) {

        if (!!options) this.setOptions(options);

        this.info('[>] new instance');
        this.info('[>] tmp_dir: %s', this.tmp_dir);
        this.info('[>] exe_path: %s', this.exe_path);
        this.info('[>] timeout: %s', this.timeout);

        this.init();
    }

    info(...args: any[]) {
        const x: any = debug(`fps:info [> ${this.powershell?.pid || -1}]`);
        x(...args);
    }

    error(...args: any[]) {
        const x: any = debug(`fps:error [! ${this.powershell?.pid || -1}]`)
        x(...args);
    }

    private setOptions(options: PowerShellOptions) {
        if (options.tmp_dir) this.tmp_dir = options.tmp_dir;
        if (options.exe_path) this.exe_path = options.exe_path;
        if (options.timeout) this.timeout = options.timeout;
        this.verbose = options.verbose ?? true;
        this.debug = options.debug ?? true;
    }

    public get pid() {
        return this.powershell.pid;
    }

    public get isBusy() {
        return this.queue.length > 0 || this.isRunning || this.closing$.value;
    }

    private init() {
        this.info('[>] init');
        const prefix = randomBytes(8).toString('hex');
        this.out_verbose = `${this.tmp_dir}${prefix}_fps_verbose.tmp`;
        this.out_debug = `${this.tmp_dir}${prefix}_fps_debug.tmp`;

        this.tick$ = new Subject<string>();

        this.initProcess();
        this.initReaders();
        this.initHandler();

        this.respawning$ = new BehaviorSubject<boolean>(false);
        this.respawned$ = new SubjectWithPromise<boolean>();

        this.closing$ = new BehaviorSubject<boolean>(false);
        this.closed$ = new SubjectWithPromise<boolean>();

        this.subscriptions = [
            this.tick$,
            this.respawning$,
            this.respawned$,
            this.closed$,
            this.closing$
        ];

        this.closed$.subscribe(res => {
            this.info('[>] closed$ emitted %s', res);
            while (this.queue.length > 0) {
                const command = this.queue.pop()!;
                this.info('[>] subject status: %s %s', command.subject.observed, command.subject.closed);
                command.subject.error(new Error('Process has been closed'));
                command.subject.complete();
                this.info('[>] cancelled command: %s', command.command);
                this.info('[>] subject status: %s %s', command.subject.observed, command.subject.closed);
            }
            for (const sub of this.subscriptions) {
                sub.unsubscribe();
            }
            this.subscriptions = [];
        })

        this.respawned$.subscribe(res => {
            this.info('[>] respawned$ emitted %s', res);
            for (const sub of this.subscriptions) {
                sub.unsubscribe();
            }
            this.subscriptions = [];
        })

        this.tick$.next('init complete');
    }

    private closeEventHandler(code: number | null, signal: NodeJS.Signals | null) {

        this.info('[>] child process emitted a \'close\' event');
        this.info('[>] exit code: %s', code);
        this.info('[>] exit signal: %s', signal);

        this.info('[>]', this.stdin?.destroyed ? 'stdin destroyed' : 'stdin not destroyed');
        this.info('[>]', this.stdout?.destroyed ? 'stdout destroyed' : 'stdout not destroyed');
        this.info('[>]', this.stderr?.destroyed ? 'stderr destroyed' : 'stderr not destroyed');

        this.info('[>] removing temp files');
        this.removeTempFile(this.out_verbose);
        this.removeTempFile(this.out_debug);

        if (this.respawning$.value) {
            this.respawned$.next(true);
        } else {
            this.closed$.next(true);
            this.info('[>] process closed');
        }

    }

    private initProcess() {

        this.info('[>] init process');

        const args = [ '-NonInteractive', '-NoLogo', '-NoExit', '-Command', '-'];

        this.powershell = spawn(this.exe_path, args, { stdio: 'pipe' });

        this.info('[>] pid: %s', this.powershell.pid);

        this.powershell.once('close', this.closeEventHandler.bind(this));

        this.powershell.stdin.setDefaultEncoding('utf8');
        this.powershell.stdout.setEncoding('utf8');
        this.powershell.stderr.setEncoding('utf8');

        this.stdin = this.powershell.stdin;
        this.stdout = this.powershell.stdout;
        this.stderr = this.powershell.stderr;
    }

    private initReaders() {

        this.info('[>] init readers');

        const read_out = new BufferReader(this.delimit_head, this.delimit_tail);
        const read_err = new BufferReader(this.delimit_head, this.delimit_tail);

        this.subscriptions.push(read_out.subject, read_err.subject);

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

    private initHandler() {

        this.info('[>] init handler');

        // subscribes to tick to trigger check for next command
        // concatMaps command handler to enforce order
        this.tick$.pipe(
            tap(caller => this.info('[>] tick %s', caller)),
            concatMap(_ => of(this.queue.shift() as Command).pipe(
                filter(command => command !== undefined),
                tap(() => this.isRunning = true),
                switchMap(command => this.invoke(command)),
                tap(() => {
                    this.isRunning = false
                    this.tick$.next('command complete')
                }),
            )),
        ).subscribe()
    }

    private invoke(command: Command) {

        this.info('[>] invoking: %s', command.command)
        this.info('[>] subject observed: %s', command.subject.observed)
        this.info('[>] subject closed: %s', command.subject.closed)

        const invoke$ = combineLatest([
            this.respawning$,
            this.closing$
        ]).pipe(
            skipWhile(([respawning, closing]) => respawning || closing),
            take(1),
            tap(() => {
                if (!this.stdin.writable) {
                    this.error('[>] stdin not writable')
                    command.subject.error(new Error('stdin not writable'));
                    throw new Error('stdin not writable');
                }
                this.stdin.write(Buffer.from(command.wrapped));
            })
        )

        const output$ = this.out$.pipe(
            take(1),
            timeout(this.timeout),
            map(result => {
                this.info('[>] complete: %s', command.command)
                command.subject.next(result); // emit from subject returned by call()
                command.subject.complete(); // complete subject returned by call()
            }),
            catchError(error => {
                this.info('[>] error: %O', error)
                if (error.name === 'TimeoutError') {
                    error = new Error(`Command timed out after ${this.timeout} milliseconds. Check the full-powershell docs for more information.`)
                }
                // respawn the process
                // only error the current subject once the new process is started
                return this.respawn().pipe(
                    tap(_ => {
                        this.isRunning = false;
                        this.init();
                        command.subject.error(error);
                    }),
                )
            })
        );

        const cancel$ = this.closing$.pipe(
            first(_ => _),
            tap(_ => this.info('[>] cancelling running task')),
            map(_ => throwError(() => new Error('Process has been closed')))
        );

        return invoke$.pipe(
            switchMap(_ => race([output$, cancel$]))
        )
    }

    public call(command: string, format: Format = 'json') {

        this.info('[>] command: %s', command)
        this.info('[>] format: %s', format)
        this.info('[>] pid: %s', this.powershell.pid)

        // subject to be returned form this method
        const subject = new SubjectWithPromise<PowerShellStreams>();

        // wrap the command in the serialisation script
        const wrapped: string = wrap({
            command,
            delimit_head: this.delimit_head,
            delimit_tail: this.delimit_tail,
            out_verbose: this.out_verbose,
            out_debug: this.out_debug,
            format,
            verbose: this.verbose,
            debug: this.debug
        });

        // queue the command context
        this.queue.push({
            command: command,
            wrapped: wrapped,
            subject: subject,
            pid: this.powershell.pid || 0
        })

        // attempt to execute the command after this function has returned the subject
        queueMicrotask(() => this.tick$.next('call queued'))

        // return the subject for this command
        return subject
    }

    private removeTempFile(file: string) {
        if (existsSync(file)) {
            this.info('[>] removing temp file %s', file);
            unlinkSync(file);
            this.info('[>] removed temp file %s', file);
        }
    }

    public respawn() {

        this.info('[>] respawn called');

        return this.respawning$.pipe(
            take(1),
            switchMap(respawning => {
                if (respawning) {
                    this.info('[>] already respawning!');
                    return this.respawned$;
                }
                this.respawning$.next(true);
                this.kill();
                return this.respawned$;
            })
        )

    }

    public destroy() {

        this.info('[>] destroy called');

        this.closing$.pipe(take(1))
            .subscribe(closing => {
                if (closing) {
                    this.info('[>] already closing!');
                } else {
                    this.closing$.next(true);
                    this.kill();
                }
            })

        return this.closed$;

    }

    private kill() {

        if (this.powershell.pid) {
            this.info('[>] killing process %s', this.powershell.pid);
            process.kill(this.powershell.pid, 'SIGTERM');
        }

        // try each until 'close' event has been received
        from<Array<'SIGKILL' | 'SIGTERM' | 'SIGINT'>>([
            // 'SIGTERM', // normal
            'SIGINT',  // ctrl+c
            'SIGKILL', // force kill
        ]).pipe(
            concatMap(item => of(item).pipe(delay(10000))),
            takeUntil(race([this.closed$, this.respawned$])),
            tap(signal => this.info('[>] sending signal %s', signal))
        )
            .subscribe(signal => {
                if (this.powershell.pid) {
                    this.info('[>] killing process %s', this.powershell.pid);
                    process.kill(this.powershell.pid, signal);
                }
            })
    }
}