# Full Powershell
_Full Powershell_ cleanly serialises all [6 message streams](https://docs.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_redirection) at their source so that they can be deserilised into JavaScript, retaining all of their semantics and completely removing the need to write brittle parsing logic.

# Background
PowerShell has 6 message streams in addition to **Stdout** and **Stderr**. Cramming these 6 streams through stdout, on top of direct output, removes the streams semantics. Additionally, parsing this mess is painful - unexpected warning or error messages make your application very brittle.

# How it works
This library accepts PowerShell commands as strings. It then transparently wraps them in an `Invoke-Command` that captures and serilises their output. This means that all 6 message streams are captured and sorted at their source. Once sent back to Node.js they can be subscribed to as 6 separate RxJS streams. Or the individual call can be subscribed to, emitting all streams in a clearly defined format. I encourage users to take a look at [index.ts](https://github.com/daverickdunn/full-powershell/blob/master/src/index.ts) and [wrapper.ts](https://github.com/daverickdunn/full-powershell/blob/master/src/wrapper.ts) to see exactly how it works.


# API

`PowerShell` class. Spawns a PowerShell child process and exposes methods to read/write to/from that process:
```typescript
class PowerShell {
    success$: Subject<Array<any>>();
    error$: Subject<Array<any>>();
    warning$: Subject<Array<any>>();
    verbose$: Subject<Array<any>>();
    debug$: Subject<Array<any>>();
    info$: Subject<Array<any>>();
    call(string: string, format: Format = 'json'): Subject<PowerShellStreams>;
    destroy(): boolean;
}
```

`PowerShellStreams` object. Emittied by the Subject returned from `PowerShell.call`.
```typescript
interface PowerShellStreams {
    success: Array<any>;
    error: Array<any>;
    warning: Array<any>;
    verbose: Array<any>;
    debug: Array<any>;
    info: Array<any>;
}
```

# Semantics
The subjects provided by the `PowerShell` class, as well as the singleton observable returned by `PowerShell.call` all return arrays. It's important to note that these arrays reflect the output for each _PowerShell command_ contained in the single string passed to `PowerShell.call`. So for example, if you were to call `PowerShell.call('Get-Date; Get-Date;')`, you should expect to receive an Array containing two items in the next emission. However, there are exceptions to this - **debug** and **verbose** are *newline* delimited due to limitations of PowerShell redirection. While they will generally equate to one string per `Write-Debug` or `Write-Verbose`, it is up to you to ensure output has not been broken into multiple lines.

# Usage

## Importing:
ES6
```typescript
import { PowerShell } from 'full-powershell';
```
CommonJS
```typescript
const PowerShell = require('full-powershell');
```

## Instantiaing:
```typescript
const shell = new PowerShell();
```

## Calling:

Pipe result object to `ConvertTo-Json` before returning:
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

## Subscribing:
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