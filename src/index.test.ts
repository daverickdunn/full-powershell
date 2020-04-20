import { PowerShell } from './index';

let shell = new PowerShell();

afterAll((done) => {
    shell.destroy();
    done();
});

test('Success', (done) => {
    shell.$success.subscribe(
        (res) => {
            expect(res).toBe('Test Text')
            done();
        }
    );
    shell.call(`Write-Output 'Test Text'`);
});

test('Error', (done) => {
    shell.$error.subscribe(
        (res) => {
            expect(res).toBe('My Error')
            done();
        }
    );
    shell.call(`Write-Error "My Error";`);
});
