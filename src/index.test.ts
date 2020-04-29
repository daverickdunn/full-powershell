import { PowerShell } from './index';

let shell = new PowerShell();

afterAll((done) => {
    shell.destroy();
    done();
});

test('Success JSON', (done) => {
    let sub = shell.$success.subscribe(
        (res) => {
            expect(res[0]).toHaveProperty('DateTime');
            sub.unsubscribe();
            done();
        }
    );
    shell.call(`Get-Date;`);
});

test('Success String', (done) => {
    let sub = shell.$success.subscribe(
        (res) => {
            expect(res[0]).toMatch('This is a test string');
            sub.unsubscribe();
            done();
        }
    );
    shell.call(`Write-Output "This is a test string";`, 'string');
});

test('Error', (done) => {
    let sub = shell.$error.subscribe(
        (res) => {
            expect(res[0]).toEqual(expect.stringContaining('My Error'));
            sub.unsubscribe();
            done();
        }
    );
    shell.call(`Write-Error "My Error";`);
});

test('Warning', (done) => {
    let sub = shell.$warning.subscribe(
        (res) => {
            expect(res[0]).toEqual(expect.stringContaining('My Warning'));
            sub.unsubscribe();
            done();
        }
    );
    shell.call(`Write-Warning "My Warning";`);
});

test('Success Multi JSON', (done) => {
    let sub = shell.$success.subscribe(
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
    let sub = shell.$success.subscribe(
        (res) => {
            expect(res[0]).toMatch('This is a test string');
            expect(res[1]).toMatch('This is another test string');
            sub.unsubscribe();
            done();
        }
    );
    shell.call(`Write-Output "This is a test string"; Write-Output "This is another test string";`, 'string');
});