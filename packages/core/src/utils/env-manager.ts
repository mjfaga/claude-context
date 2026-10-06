import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class EnvManager {
    private envFilePath: string;

    constructor() {
        const homeDir = os.homedir();
        this.envFilePath = path.join(homeDir, '.context', '.env');
    }

    get(name: string): string | undefined {
        if (process.env[name]) {
            return process.env[name];
        }

        try {
            if (fs.existsSync(this.envFilePath)) {
                const content = fs.readFileSync(this.envFilePath, 'utf-8');
                const lines = content.split('\n');

                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (trimmedLine.startsWith(`${name}=`)) {
                        return trimmedLine.substring(name.length + 1);
                    }
                }
            }
        } catch (error) {
            // Ignore file read errors
        }

        return undefined;
    }

    set(name: string, value: string): void {
        try {
            const envDir = path.dirname(this.envFilePath);
            if (!fs.existsSync(envDir)) {
                fs.mkdirSync(envDir, { recursive: true });
            }

            let content = '';
            let found = false;

            if (fs.existsSync(this.envFilePath)) {
                content = fs.readFileSync(this.envFilePath, 'utf-8');

                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].trim().startsWith(`${name}=`)) {
                        lines[i] = `${name}=${value}`;
                        found = true;
                        console.log(`[EnvManager] ✅ Updated ${name} in ${this.envFilePath}`);
                        break;
                    }
                }
                content = lines.join('\n');
            }

            if (!found) {
                if (content && !content.endsWith('\n')) {
                    content += '\n';
                }
                content += `${name}=${value}\n`;
                console.log(`[EnvManager] ✅ Added ${name} to ${this.envFilePath}`);
            }

            fs.writeFileSync(this.envFilePath, content, 'utf-8');

        } catch (error) {
            console.error(`[EnvManager] ❌ Failed to write env file: ${error}`);
            throw error;
        }
    }

    getEnvFilePath(): string {
        return this.envFilePath;
    }
}

export const envManager = new EnvManager(); 