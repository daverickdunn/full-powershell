![alt text](img/waves.svg)

# Full Powershell
Capture, separate and serialise all [6 PowerShell message streams](https://docs.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_redirection) at their source.

# How it works
PowerShell has 6 message streams in addition to **Stdout** and **Stderr**. Cramming these 6 streams all through stdout removes each stream's semantics and is a nightmare to parse. Unexpected and intermittent warning or error messages (very common when remoting!) will make your application very brittle. Full-PowerShell sorts these streams _before_ returning them, so output from one stream will not affect the other, so unexpected server messages won't break your program.

This library accepts PowerShell commands as strings. It wraps those commands in an `Invoke-Command` block that pipes their output into individual streams. All 6 message streams are captured and sorted at their source, they are then serialised using PowerShell's standard `ConvertTo-JSON` function, sent back to the parent Node.js process, before finally being deserilaised as individual streams. They can be subscribed to as an RxJS Observable, or as a Promise. 

The source code is fairly concise, take a look at [index.ts](https://github.com/daverickdunn/full-powershell/blob/master/src/index.ts) and [wrapper.ts](https://github.com/daverickdunn/full-powershell/blob/master/src/wrapper.ts) to see exactly how it works.

# API

## The `PowerShell` class.
Spawns a PowerShell child process on instantiation and exposes methods to read/write to/from that process:
```typescript
class PowerShell {
    constructor(private options?: PowerShellOptions);
    success$: Subject<any[]>();
    error$: Subject<any[]>();
    warning$: Subject<any[]>();
    verbose$: Subject<any[]>();
    debug$: Subject<any[]>();
    info$: Subject<any[]>();
    call(command: string, format: Format = 'json'): SubjectWithPromise<PowerShellStreams>;
    destroy(): boolean;
}
```

_Note: The `SubjectWithPromise` object returned by `call()` will only emit the value returned by the command passed to `call()`. Use the streams postfixed with `$` to listen to output from all calls made to that `PowerShell` instance._


## The `PowerShellStreams` object.
Emittied by the `<Observable|Promise>` returned from `.call().subscribe()` or `.call().promise()`.
```typescript
interface PowerShellStreams {
    success: any[];
    error: any[];
    warning: any[];
    verbose: any[];
    debug: any[];
    info: any[];
}
```

The subjects exposed by the `PowerShell` class, as well as the singleton observable/promise returned by `PowerShell.call` all return arrays of strings or parsed JSON. It's important to note that these arrays reflect the output for **each** PowerShell command passed to `PowerShell.call`. For example, if you were to call `PowerShell.call('Get-Date; Get-Date;')`, you should expect to receive an Array containing two items in the next emission's success stream. However, there are exceptions to this - **debug** and **verbose** are *newline* delimited due to limitations of PowerShell redirection. While they will generally equate to one string per `Write-Debug` or `Write-Verbose`, it is up to you to ensure output has not been broken into multiple lines.

## Importing:
ES6
```typescript
import { PowerShell } from 'full-powershell';
```
CommonJS
```javascript
const { PowerShell } = require('full-powershell');
```

## Instantiating:
```typescript
const shell = new PowerShell();
```

Options:
```typescript
interface PowerShellOptions {
    tmp_dir?: string
    exe_path?: string
    timeout?: number
}
```

- `tmp_dir` - _Default: current directory_ Change the path for ephemeral '.tmp' files. Must have a trailing slash. (Must be set to `/tmp/` when executing on AWS Lambda). 

- `exe_path` - _Default: `powershell` for windows, `pwsh` for nix_ Explicitly set the path or command name for the PowerShell executable.
    - example: `pwsh`
    - example: `C:\\Program Files\\PowerShell\\7\\pwsh.exe`

- `timeout` - _Default: 10 minutes_. Set number of milliseconds before each call to this shell will timeout. **Warning:** A timeout will result in the PowerShell child process being terminated and a new process created, any pending calls will be errored and PowerShell context will be lost.

Example:
```typescript
const options: PowerShellOptions = {
    tmp_dir: '/tmp/'
    exe_path: 'pwsh',
    timeout: 60000
}
const shell = new PowerShell(options);
```

## Executing PowerShell Commands:

The call function accepts a PowerShell command as a string, and a an optional format paramter. Use the format parameter to change how _Full Powershell_ will serialise the command output before returing it from PowerShell.

```typescript
type Format = 'string' | 'json' | null;
shell.call(command: string, format: Format = 'json')
```

### Examples:

Pipe result object to `ConvertTo-Json` before returning (default):
```typescript
shell.call('My-Command');
```
Pipe result object to `Out-String` before returning:
```typescript
shell.call('My-Command', 'string');
```
Return result object using default string output:
```typescript
shell.call('My-Command', null);
```

## Subscribing to PowerShell Streams:
Subscribe directly to a call (observable will complete after first emission):
```typescript
shell.call('My-Command')
.subscribe(
    (res: PowerShellStreams) => {
        /* result handler */
    },
    (err: Error) => {
        /* error handler */
    }
);
```
Subscribe to individual streams (observe all output i.e. all emissions of that type):
```typescript
const shell = new PowerShell();

shell.success$
.subscribe(
    (res: Array<any>) => {
        /* result handler */
    },
    (err: Error) => {
        /* error handler */
    }
);

shell.error$.subscribe( /* same as success$ */);
shell.warning$.subscribe( /* same as success$ */);
shell.verbose$.subscribe( /* same as success$ */);
shell.debug$.subscribe( /* same as success$ */);
shell.info$.subscribe( /* same as success$ */);
```

## Promises:
The object returned by the `call` method also exposes a function called `promise()` which returns a promise which will emit the first value returned by the shell.

```typescript
shell.call('My-Command')
.promise()
.then((res: PowerShellStreams) => {
    /* result handler */
})
```

# Example:

```typescript
import { PowerShell } from 'full-powershell';

let powershell = new PowerShell();

powershell.success$.subscribe(res => {
    console.log('success:', res)
});

powershell.error$.subscribe(res => {
    console.log('error:', res)
});

powershell.warning$.subscribe(res => {
    console.log('warning:', res)
});

powershell.call('Get-Date', 'json');
powershell.call('throw "My Error"', 'json');

powershell.call('Get-Date; Write-Warning "My Warning";', 'json')
.subscribe(
    res => {
        console.log(res.success);
        console.log(res.warning)
    },
    err => {
        console.error(err);
    }
);
```