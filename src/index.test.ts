import { bufferCount, catchError, of, throwError } from 'rxjs';
import { PowerShell } from './index';

jest.setTimeout(10000)

test('Success JSON', (done) => {
    let shell = new PowerShell();
    shell.success$.subscribe(
        (res) => {
            expect(res[0]).toHaveProperty('DateTime');
            shell.destroy();
            done();
        }
    );
    shell.call(`Get-Date;`);
});

test('Success String', (done) => {
    let shell = new PowerShell();
    shell.success$.subscribe(
        (res) => {
            expect(res[0]).toMatch('Testing Write-Output');
            shell.destroy();
            done();
        }
    );
    shell.call(`Write-Output "Testing Write-Output";`, 'string');
});

test('Success Default toString', (done) => {
    let shell = new PowerShell();
    shell.success$.subscribe(
        (res) => {
            expect(res[0]).toMatch('Testing Write-Output');
            shell.destroy();
            done();
        }
    );
    shell.call(`Write-Output "Testing Write-Output";`, null);
});

test('Error', (done) => {
    let shell = new PowerShell();
    shell.error$.subscribe(
        (res) => {
            expect(res[0]).toEqual(expect.stringContaining('Testing Write-Error'));
            shell.destroy();
            done();
        }
    );
    shell.call(`Write-Error "Testing Write-Error";`);
});

test('Warning', (done) => {
    let shell = new PowerShell();
    shell.warning$.subscribe(
        (res) => {
            expect(res[0]).toEqual(expect.stringContaining('Testing Write-Warning'));
            shell.destroy();
            done();
        }
    );
    shell.call(`Write-Warning "Testing Write-Warning";`);
});

test('Verbose', (done) => {
    let shell = new PowerShell();
    shell.verbose$.subscribe(
        (res) => {
            expect(res[0]).toEqual(expect.stringContaining('Testing Write-Verbose'));
            shell.destroy();
            done();
        }
    );
    shell.call(`$VerbosePreference = 'Continue'; Write-Verbose "Testing Write-Verbose";`);
});

test('Debug', (done) => {
    let shell = new PowerShell();
    shell.debug$.subscribe(
        (res) => {
            expect(res[0]).toEqual(expect.stringContaining('Testing Write-Debug'));
            shell.destroy();
            done();
        }
    );
    shell.call(`$DebugPreference = 'Continue'; Write-Debug "Testing Write-Debug";`);
});

test('Info', (done) => {
    let shell = new PowerShell();
    shell.info$.subscribe(
        (res) => {
            expect(res[0]).toEqual(expect.stringContaining('Testing Write-Information'));
            shell.destroy();
            done();
        }
    );
    shell.call(`$InformationPreference = 'Continue'; Write-Information "Testing Write-Information";`);
});

test('Success Multi JSON', (done) => {
    let shell = new PowerShell();
    shell.success$.subscribe(
        (res) => {
            expect(res[0]).toHaveProperty('DateTime');
            expect(res[1]).toHaveProperty('DateTime');
            shell.destroy();
            done();
        }
    );
    shell.call(`Get-Date; Get-Date;`);
});

test('Success Multi String', (done) => {
    let shell = new PowerShell();
    shell.success$.subscribe(
        (res) => {
            expect(res[0]).toMatch('This is a test string');
            expect(res[1]).toMatch('This is another test string');
            shell.destroy();
            done();
        }
    );
    shell.call(`Write-Output "This is a test string"; Write-Output "This is another test string";`, 'string');
});

test('Call Structure', (done) => {
    let shell = new PowerShell();
    shell.call(`Write-Output "This is a test string";`, 'string')
        .subscribe(res => {
            expect(res).toHaveProperty('success');
            expect(res).toHaveProperty('error');
            expect(res).toHaveProperty('warning');
            expect(res).toHaveProperty('info');
            shell.destroy();
            done();
        })
});

test('Variable Scope', (done) => {
    let shell = new PowerShell();
    shell.call(`$XYZ = 'something';`);
    shell.call(`Write-Output $XYZ;`).subscribe(res => {
        expect(res.success).toContain('something');
        shell.destroy();
        done();
    })
});

test('Promises', (done) => {
    let shell = new PowerShell();
    shell.call(`Write-Output "Testing Promises";`, 'string').promise()
        .then(res => {
            expect(res.success[0]).toMatch('Testing Promises');
            return shell.call(`Write-Output "Testing More Promises";`, 'string').promise();
        })
        .then(res => {
            expect(res.success[0]).toMatch('Testing More Promises');
            shell.destroy();
            done();
        })
});

test('Temporary File Directory', (done) => {
    const shell = new PowerShell({ tmp_dir: './temp/' });
    shell.call(`Write-Output "Testing tmp_dir";`, 'string')
        .subscribe(
            res => {
                expect(res.success[0]).toMatch('Testing tmp_dir');
                shell.destroy();
                done();
            });
});

test('PowerShell Path', (done) => {
    // NOTE: this test will only run on a Windows instance with PowerShell 7 installed in the directory below.
    const shell = new PowerShell({ exe_path: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' });
    shell.call(`Write-Output "Testing exe_path";`, 'string')
        .subscribe(
            res => {
                expect(res.success[0]).toMatch('Testing exe_path');
                shell.destroy();
                done();
            });
});

test('Concurrent Calls', (done) => {

    let shell = new PowerShell();

    shell.success$.pipe(
        bufferCount(4)
    )
        .subscribe(
            (res) => {
                expect(res[0][0]).toMatch('Call 1');
                expect(res[1][0]).toMatch('Call 2');
                expect(res[2][0]).toMatch('Call 3');
                expect(res[3][0]).toMatch('Call 4');
                shell.destroy();
                done();
            }
        );

    shell.call(`Start-Sleep -m 300; Write-Output "Call 1";`, 'string');
    shell.call(`Start-Sleep -m 200; Write-Output "Call 2";`, 'string');
    shell.call(`Start-Sleep -m 100; Write-Output "Call 3";`, 'string');
    shell.call(`Start-Sleep -m 400; Write-Output "Call 4";`, 'string');

});

test('Command Timeout', (done) => {

    // there are, in effect, 3 stages to this test

    let shell = new PowerShell({
        timeout: 2000
    });

    // 1: should cause the shell to be destroyed
    shell.call(`Start-Sleep -Seconds 3;`)
        .subscribe({
            error: err => {
                expect(err.message).toBe('Timeout has occurred');
            }
        })

    // 2: should error because shell was destroyed
    shell.call('Write-Output "Concurrent Call";')
        .subscribe({
            error: err => {
                // 3: should succeed because new shell was created
                shell.call('Write-Output "Call After Reset";')
                    .subscribe({
                        next: res => {
                            expect(res.success[0]).toMatch('Call After Reset');
                            shell.destroy();
                            done()
                        }
                    })
            }
        })

});

test('Throwing PowerShell Error', (done) => {
    let shell = new PowerShell();
    shell.error$.subscribe(
        (res) => {
            expect(res[0]).toEqual(expect.stringContaining('Some Error!'));
        }
    );
    shell.success$.subscribe(
        (res) => {
            expect(res[0]).toEqual(expect.stringContaining('Still running!'));
            shell.destroy();
            done();
        }
    );
    shell.call(`throw "Some Error!"`);
    shell.call(`Write-Output "Still running!"`);
});

// test('Child Process Closed Itself', (done) => {

//     let shell = new PowerShell();
//     shell.call(`Stop-Process -Id $PID;`)
//         .subscribe({
//             error: err => {
//                 expect(err.message).toBe('child process closed itself');
//                 shell.destroy();
//                 done()
//             }
//         })

// });