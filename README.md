# Full Powershell
PowerShell has 6 message streams! That makes streaming directly through stdout and stderr a complete mess. This package adds a simple wrapper around your PowerShell commands to capture, separate and serialise all 6 streams at their source. They can then be subscribed to individually via RxJS, removing the headache of parsing noise from your data.


## How it works
This library accepts PowerShell commands as strings. It then injects them into a wrapper script that captures and serilises their output. This means that all 6 message streams are captured and sorted at their source. Once sent back to NodejS they emit as 6 separate RxJS streams. I encourage users to take a look at [index.ts](https://github.com/daverickdunn/full-powershell/blob/master/src/index.ts) and [wrapper.ts](https://github.com/daverickdunn/full-powershell/blob/master/src/wrapper.ts) to see exactly how it works.


## Usage

### Example:

```typescript
import { PowerShell } from 'full-powershell';

let powershell = new PowerShell();

powershell.success$.subscribe(res => {
    console.log('success:', res)
})

powershell.error$.subscribe(res => {
    console.log('error:', res)
})

powershell.warning$.subscribe(res => {
    console.log('warning:', res)
})

powershell.call('Get-Date', 'json')
powershell.call('throw "My Error"', 'json')
powershell.call('Get-Date; Write-Warning "My Warning";', 'json')
```

### Output:

```
success: {
  value: '/Date(1587418070274)/',
  DisplayHint: 2,
  DateTime: '20 April 2020 22:27:50'
}
error: My Error
At line:3 char:13
+             throw "My Error"
+             ~~~~~~~~~~~~~~~~
    + CategoryInfo          : OperationStopped: (My Error:String) [], RuntimeException
    + FullyQualifiedErrorId : My Error


error: My Error

success: {
  value: '/Date(1587418070364)/',
  DisplayHint: 2,
  DateTime: '20 April 2020 22:27:50'
}
warning: My Warning
```