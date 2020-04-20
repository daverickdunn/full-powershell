import os from 'os';

export type Format = 'string' | 'json' | 'csv' | 'html';

function serialise(variable: string, format: Format) {
    if (format === 'json'){
        return `ConvertTo-Json -InputObject @(${variable}) -Compress`;
    } 
    if (format === 'string'){
        return `@(${variable} | ForEach-Object { $_ | Out-String })`;
    }
    if (format === 'csv'){
        return `ConvertTo-Csv -InputObject ${variable}`;
    }
    if (format === 'html'){
        return `${variable} | ConvertTo-Html`;
    }
}

export function wrap(command: string, EOI: string, format: Format) {
    const template = 
    `
    $rxjs_pwsh_1 = @();
    try {
        Invoke-Command -ScriptBlock {
            ${command}
        } *>$null -OutVariable rxjs_pwsh_1 -ErrorVariable rxjs_pwsh_2 -WarningVariable rxjs_pwsh_3 -InformationVariable rxjs_pwsh_6
    } 
    catch { }
    finally {
        $rxjs_pwsh = [pscustomobject]@{ 
            result = [pscustomobject]@{ 
                success = ${serialise('$rxjs_pwsh_1', format)}
                error = @($rxjs_pwsh_2 | ForEach-Object { $_ | Out-String })
                warning = @($rxjs_pwsh_3 | ForEach-Object { $_ | Out-String })
                info = @($rxjs_pwsh_6 | ForEach-Object { $_ | Out-String })
                format = "${format}"
            }
        }
        $rxjs_pwsh | ConvertTo-Json
    }
    $EOI_1 = "${EOI.slice(0, 5)}"
    $EOI_2 = "${EOI.slice(5)}"
    [Console]::Out.Write("$EOI_1$EOI_2")
    ${os.EOL}
    `;
    return template;
}
