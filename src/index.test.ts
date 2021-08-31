import { PowerShell } from './index';

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
    // NOTE: this test will only run on a Windows instance with pwsh installed in the directory below.
    const shell = new PowerShell({ exe_path: `${process.env.SystemRoot}\\system32\\WindowsPowerShell\\v1.0\\powershell.exe` });
    shell.call(`Write-Output "Testing exe_path";`, 'string')
        .subscribe(
            res => {
                expect(res.success[0]).toMatch('Testing exe_path');
                shell.destroy();
                done();
            });
});