import os from 'os';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { Observable, Subject } from 'rxjs';
import { Readable, Writable } from 'stream';
import { wrap, Format } from './wrapper';

interface PowerShellStreams {
    success: string;
    error: string;
    warning: string;
    info: string;
    format: Format;
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
    private buffer: Buffer = new Buffer('');
    private eoi: Buffer;

    constructor(eoi: string) {
        super();
        this.eoi = Buffer.from(eoi);
    }

    extract(): Buffer {
        let idx = this.buffer.indexOf(this.eoi);
        let data = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + this.eoi.length);
        return data;
    }

    _write(chunk: Buffer, encoding: string, callback: Function) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        while (this.buffer.includes(this.eoi)) {
            const extracted = this.extract();
            this.subject.next(extracted.toString('utf8'));
        }
        callback();
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
    public $success = new Subject<Array<string>>();
    public $error = new Subject<Array<string>>();
    public $warning = new Subject<Array<string>>();
    public $verbose = new Subject<Array<string>>();
    public $debug = new Subject<Array<string>>();
    public $info = new Subject<Array<string>>();

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
            try {
                let result = JSON.parse(res).result as PowerShellStreams;
                let success = parseStream(result.success, result.format);
                let error = parseStream(result.error, 'json');
                let warning = parseStream(result.warning, 'json');
                let info = parseStream(result.info, 'json');

                if (success.length > 0) this.$success.next(success);
                if (error.length > 0) this.$error.next(error);
                if (warning.length > 0) this.$warning.next(warning);
                if (info.length > 0) this.$info.next(info);
            } catch (e) {
                console.log(res);
                console.log(e);
                console.log(process.eventNames());
            }
        });

        read_err.subject.subscribe((res) => {
            this.$error.next([res]);
        });
    }

    call(string: string, format: Format = 'json'): void {
        write(this.stdin, wrap(string, this.EOI, format)).subscribe();
    }

    destroy() {
        this.powershell.kill();
    }
}
