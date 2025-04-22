import { debug } from 'debug';
import { existsSync, unlinkSync } from 'fs';
import os from 'os';
import {
    EMPTY,
    Observable,
    ReplaySubject,
    Subject,
    catchError,
    concatMap,
    delay,
    exhaustMap,
    filter,
    first,
    firstValueFrom,
    from,
    map,
    of,
    race,
    take,
    takeUntil,
    tap,
    throwError,
    timeout
} from 'rxjs';
import { PowerShellProcess, PowerShellStreams } from './process';
import { Format } from './wrapper';

interface Command {
    command: string;
    format: Format;
    subject: Subject<PowerShellStreams>;
}

class SubjectWithPromise<T> extends Subject<T> {
    async promise() {
        return firstValueFrom(this);
    }
}

interface PowerShellOptions {
    tmp_dir?: string
    exe_path?: string
    timeout?: number // milliseconds
    verbose?: boolean
    debug?: boolean
}

class PwshTimeoutError extends Error {
    constructor(public timeout: number, public command: Command) {
        const message = `Command timed out after ${timeout} milliseconds. Check the full-powershell docs for more information.`;
        super(message);
        this.name = 'PwshTimeoutError';
    }
}

export class PowerShell {

    public success$ = new Subject<Array<any>>();
    public error$ = new Subject<Array<any>>();
    public warning$ = new Subject<Array<any>>();
    public verbose$ = new Subject<Array<any>>();
    public debug$ = new Subject<Array<any>>();
    public info$ = new Subject<Array<any>>();

    private powershell: PowerShellProcess;

    private out$: Observable<PowerShellStreams>;
    private out_verbose: string;
    private out_debug: string;

    private queue: Command[] = [];
    private command: Command | null = null;

    private tick$: Subject<string>;
    private running = false;

    private closing = false;
    private closed$ = new ReplaySubject<boolean>();

    private restarting = false;
    private restarted$: ReplaySubject<boolean>;

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

    private info(...args: any[]) {
        const x: any = debug(`fps:info [> ${this.powershell?.pid || -1}]`);
        x(...args);
    }

    private error(...args: any[]) {
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
        return this.queue.length > 0 || this.running;
    }

    private init() {

        this.info('[>] init');

        this.powershell = new PowerShellProcess(this.exe_path, this.tmp_dir);

        this.info('[>] pid: %s', this.powershell.pid);

        this.powershell.closed.pipe(take(1)).subscribe(({ code, signal }) => {
            this.closeEventHandler(code, signal)
        })

        this.out$ = this.powershell.listen;
        this.closing = false;
        this.closed$.next(false);
        this.restarted$ = new ReplaySubject<boolean>();

        this.tick$ = new Subject<string>();
        this.listen();
        this.tick$.next('init complete');
    }

    private unsubscribe() {
        this.info('[>] unsubscribe');
        this.tick$.complete();
    }

    private closeEventHandler(code: number | null, signal: NodeJS.Signals | null) {

        this.info('[>] child process emitted a \'close\' event');
        this.info('[>] exit code: %s', code);
        this.info('[>] exit signal: %s', signal);

        this.info('[>] removing temp files');
        this.removeTempFile(this.out_verbose);
        this.removeTempFile(this.out_debug);

        if (this.restarting) {
            this.unsubscribe();
            this.restarting = false;
            this.init();
            this.restarted$.next(true);
            this.info('[>] process restarted');
        } else {

            this.closing = true;

            if (this.command) {
                this.command.subject.error(new Error('Process has been closed'));
                this.info('[>] cancelled command: %s', this.command.command);
                this.command = null;
            }

            while (this.queue.length > 0) {
                const command = this.queue.pop()!;
                command.subject.error(new Error('Process has been closed'));
                this.info('[>] cancelled command: %s', command.command);
            }

            this.closed$.next(true);
            this.info('[>] process closed');
        }
    }


    private listen() {
        // subscribes to tick to trigger check for next command
        // concatMaps command handler to enforce order

        this.info('[>] init handler');

        return this.tick$
            .pipe(
                tap((caller) => this.info('[>] tick: %s', caller)),
                exhaustMap(() => {

                    if (this.closing) {
                        this.info('[>] closing, skipping tick');
                        return EMPTY;
                    }

                    if (this.restarting) {
                        this.info('[>] restarting, skipping tick');
                        return EMPTY;
                    }

                    const command = this.queue.shift();

                    if (!command) {
                        this.info('[>] no command to run');
                        return EMPTY;
                    }

                    this.command = command;
                    this.running = true;

                    queueMicrotask(() => {
                        this.info('[>] command written to pid %s', this.powershell.pid);
                        this.powershell.write(command.command, command.format, this.verbose, this.debug)
                    });

                    this.info('[>] command running: %s', command.command);

                    return this.out$.pipe(
                        tap((out) => this.info('[>] out$ emitted %O', out)),
                        take(1),
                        timeout({
                            each: this.timeout,
                            with: () => throwError(() => new PwshTimeoutError(this.timeout, command)),
                        }),
                        takeUntil(this.closed$.pipe(filter(_ => _))),
                        map(result => ({ command, result })),
                        catchError(err => {
                            if (err.name === 'PwshTimeoutError') {
                                this.error('[>] command timed out (inner catch): %s', err.command.command);
                                this.restarting = true;
                                command.subject.error(err);
                                this.kill();
                                return EMPTY;
                            }
                            return throwError(() => err);
                        })
                    )
                })
            )
            .subscribe({
                next: ({ command, result }) => {
                    this.info('[>] result: %O', result)

                    if (result.success.length > 0) this.success$.next(result.success);
                    if (result.error.length > 0) this.error$.next(result.error);
                    if (result.warning.length > 0) this.warning$.next(result.warning);
                    if (result.verbose.length > 0) this.verbose$.next(result.verbose);
                    if (result.debug.length > 0) this.debug$.next(result.debug);
                    if (result.info.length > 0) this.info$.next(result.info);

                    command.subject.next(result);
                    command.subject.complete();

                    this.command = null;
                    this.running = false;

                    queueMicrotask(() => this.tick$.next('command complete'));

                },
                error: (err) => {
                    this.error('[>] error: %O', err);
                    err.command.subject.error(err);
                },
                complete: () => {
                    this.info('[>] complete')
                }
            })

    }

    public call(command: string, format: Format = 'json') {

        this.info('[>] command queued: %s', command)
        this.info('[>] format: %s', format)

        // subject to be returned form this method
        const subject = new SubjectWithPromise<PowerShellStreams>();

        // queue the command context
        this.queue.push({ command, format, subject })

        queueMicrotask(() => this.tick$.next('command queued'))

        return subject
    }

    private removeTempFile(file: string) {
        if (existsSync(file)) {
            this.info('[>] removing temp file %s', file);
            unlinkSync(file);
            this.info('[>] removed temp file %s', file);
        }
    }

    public destroy(): SubjectWithPromise<boolean> {

        this.info('[>] destroy called');

        if (this.closing) {
            this.info('[>] already closing!');
        } else if (this.restarting) {
            this.info('[>] waiting until process has finished restarting!');
            this.restarted$.pipe(take(1)).subscribe(() => {
                this.info('[>] process has finished restarting!');
                this.closing = true;
                this.kill();
            });
        } else {
            this.closing = true;
            this.kill();
        }

        const subject = new SubjectWithPromise<boolean>();
        
        this.closed$.pipe(first(_ => _)).subscribe(() => {
            subject.next(true);
            subject.complete();
        });

        return subject;

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
            takeUntil(race([
                this.closed$.pipe(first(_ => _)),
                this.restarted$.pipe(first(_ => _))
            ])),
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