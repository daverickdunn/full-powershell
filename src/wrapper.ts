import os from 'os';

export type Format = 'string' | 'json' | null;

function serialise(variable: string, format: Format) {
    if (format === 'json') {
        return `ConvertTo-Json -InputObject @(${variable}) -Compress`;
    }
    if (format === 'string') {
        return `ConvertTo-Json -InputObject @(${variable} | ForEach-Object { Out-String -InputObject $_ }) -Compress`;
    } else {
        return `${variable}`
    }
}

export function wrap(command: string, delimit_head: string, delimit_tail: string, format: Format) {
    const template = `
    $OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8;
    $delimit_head_A = "${delimit_head.slice(0, 5)}"
    $delimit_head_B = "${delimit_head.slice(5)}"
    $delimit_tail_A = "${delimit_tail.slice(0, 5)}"
    $delimit_tail_B = "${delimit_tail.slice(5)}"
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
                error = ${serialise('$rxjs_pwsh_2', 'string')}
                warning = ${serialise('$rxjs_pwsh_3', 'string')}
                info = ${serialise('$rxjs_pwsh_6', 'string')}
                format = "${format}"
            }
        }
        $rxjs_pwsh_json = $rxjs_pwsh | ConvertTo-Json -Depth 2
        "$delimit_head_A$delimit_head_B" + $rxjs_pwsh_json + "$delimit_tail_A$delimit_tail_B"
    }
    ${os.EOL}
    `;
    return template;
}
