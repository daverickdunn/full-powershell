import { PowerShell } from './index';

let shell = new PowerShell();

afterAll((done) => {
    shell.destroy();
    done();
});

test('Success JSON', (done) => {
    let sub = shell.success$.subscribe(
        (res) => {
            expect(res[0]).toHaveProperty('DateTime');
            sub.unsubscribe();
            done();
        }
    );
    shell.call(`Get-Date;`);
});

test('Success String', (done) => {
    let sub = shell.success$.subscribe(
        (res) => {
            expect(res[0]).toMatch('Testing Write-Output');
            sub.unsubscribe();
            done();
        }
    );
    shell.call(`Write-Output "Testing Write-Output";`, 'string');
});

test('Error', (done) => {
    let sub = shell.error$.subscribe(
        (res) => {
            expect(res[0]).toEqual(expect.stringContaining('Testing Write-Error'));
            sub.unsubscribe();
            done();
        }
    );
    shell.call(`Write-Error "Testing Write-Error";`);
});

test('Warning', (done) => {
    let sub = shell.warning$.subscribe(
        (res) => {
            expect(res[0]).toEqual(expect.stringContaining('Testing Write-Warning'));
            sub.unsubscribe();
            done();
        }
    );
    shell.call(`Write-Warning "Testing Write-Warning";`);
});

test('Verbose', (done) => {
    let sub = shell.verbose$.subscribe(
        (res) => {
            expect(res[0]).toEqual(expect.stringContaining('Testing Write-Verbose'));
            sub.unsubscribe();
            done();
        }
    );
    shell.call(`$VerbosePreference = 'Continue'; Write-Verbose "Testing Write-Verbose";`);
});

test('Debug', (done) => {
    let sub = shell.debug$.subscribe(
        (res) => {
            expect(res[0]).toEqual(expect.stringContaining('Testing Write-Debug'));
            sub.unsubscribe();
            done();
        }
    );
    shell.call(`$DebugPreference = 'Continue'; Write-Debug "Testing Write-Debug";`);
});

test('Info', (done) => {
    let sub = shell.info$.subscribe(
        (res) => {
            expect(res[0]).toEqual(expect.stringContaining('Testing Write-Information'));
            sub.unsubscribe();
            done();
        }
    );
    shell.call(`$InformationPreference = 'Continue'; Write-Information "Testing Write-Information";`);
});

test('Success Multi JSON', (done) => {
    let sub = shell.success$.subscribe(
        (res) => {
            expect(res[0]).toHaveProperty('DateTime');
            expect(res[1]).toHaveProperty('DateTime');
            sub.unsubscribe();
            done();
        }
    );
    shell.call(`Get-Date; Get-Date;`);
});

test('Success Multi String', (done) => {
    let sub = shell.success$.subscribe(
        (res) => {
            expect(res[0]).toMatch('This is a test string');
            expect(res[1]).toMatch('This is another test string');
            sub.unsubscribe();
            done();
        }
    );
    shell.call(`Write-Output "This is a test string"; Write-Output "This is another test string";`, 'string');
});

test('Call Structure', (done) => {
    let sub = shell.call(`Write-Output "This is a test string";`, 'string')
    .subscribe(res => {
        expect(res).toHaveProperty('success');
        expect(res).toHaveProperty('error');
        expect(res).toHaveProperty('warning');
        expect(res).toHaveProperty('info');
        sub.unsubscribe();
        done();
    })
});

test('Variable Scope', (done) => {
    shell.call(`$XYZ = 'something';`);
    let sub = shell.call(`Write-Output $XYZ;`).subscribe(res => {
        expect(res.success).toContain('something');
        sub.unsubscribe();
        done();
    })
});