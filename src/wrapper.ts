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
    $vv = "fps_verbose.tmp"
    $dv = "fps_debug.tmp"
    $delimit_head_A = "${delimit_head.slice(0, 5)}"
    $delimit_head_B = "${delimit_head.slice(5)}"
    $delimit_tail_A = "${delimit_tail.slice(0, 5)}"
    $delimit_tail_B = "${delimit_tail.slice(5)}"
    try {
        Invoke-Command -ScriptBlock {
            ${command}
        } 1>$null 2>$null 3>$null 4>$vv 5>$dv 6>$null -ov ov -ev ev -wv wv -iv iv
    } 
    catch { }
    finally {

        $verbose = Get-Content $vv
        $debug = Get-Content $dv

        $rxjs_pwsh = [pscustomobject]@{ 
            result = [pscustomobject]@{ 
                success = ${serialise('$ov', format)}
                error = ${serialise('$ev', 'string')}
                warning = ${serialise('$wv', 'string')}
                verbose = ${serialise('$verbose', 'string')}
                debug = ${serialise('$debug', 'string')}
                info = ${serialise('$iv', 'string')}
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
