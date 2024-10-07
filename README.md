![Full PowerShell Waves](img/waves.svg)

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
    destroy(): SubjectWithPromise<boolean>;
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

- `exe_path` - _Default: `powershell` for windows, `pwsh` for nix_. Explicitly set the path or command name for the PowerShell executable (example: `'pwsh'` or `'C:\\Program Files\\PowerShell\\7\\pwsh.exe'`)

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

The `call` method accepts a PowerShell command as a string, and an optional `Format` parameter. Use the format parameter to change how command output is serialised before returing it from PowerShell.

```typescript
type Format = 'string' | 'json' | null;

shell.call(command: string, format: Format = 'json')
```


The `call` method returns an `SubjectWithPromise` object that provides two methods for handling the response:

- `subscribe` - an RxJS Subject
- `promise` - a standard JavaScript promise



## Subscribing to the RxJS Subject:
Subscribe directly to a call by calling `subscribe()` on the returned object (observable will complete after first emission):

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

## Async/Await:
The object returned by the `call` method also exposes a function called `promise()` which returns a promise instead of a subscription.

```typescript
const { success, error, warning } = await shell.call('My-Command').promise();
```


## Subscribing to all events:
In addition to subscribing/awaiting to individual calls, you can subscribe to the message streams individually. These Subscriptions will emit the results of all calls made to the instance. This may be useful for logging.

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


## Closing the Child Process:
It's important to signal when you are finished with the instance, otherwise your program might not exit gracefully. You should also wait for this task to complete.

```typescript
shell.destroy().subscribe((destroyed: boolean) => { /*...*/ });
```
or
```typescript
const destroyed: boolean = await shell.destroy().promise();
```
