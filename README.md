# full-powershell
PowerShell has 6 message streams! That makes streaming directly through stdout and stderr a complete mess. This package adds a simple wrapper around your PowerShell commands to capture, separate and serialise all 6 streams at their source. They can then be subscribed to individually via RxJS, removing the headache of parsing noise from your data.
