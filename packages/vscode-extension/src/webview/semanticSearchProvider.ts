import * as vscode from 'vscode';
import { WebviewHelper } from './webviewHelper';
import { SearchCommand } from '../commands/searchCommand';
import { IndexCommand } from '../commands/indexCommand';
import { SyncCommand } from '../commands/syncCommand';
import { ConfigManager, EmbeddingProviderConfig } from '../config/configManager';
import * as path from 'path';

export class SemanticSearchViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'semanticSearchView';
    private searchCommand: SearchCommand;
    private indexCommand: IndexCommand;
    private syncCommand: SyncCommand;
    private configManager: ConfigManager;

    constructor(private readonly _extensionUri: vscode.Uri, searchCommand: SearchCommand, indexCommand: IndexCommand, syncCommand: SyncCommand, configManager: ConfigManager) {
        this.searchCommand = searchCommand;
        this.indexCommand = indexCommand;
        this.syncCommand = syncCommand;
        this.configManager = configManager;
    }

    updateCommands(searchCommand: SearchCommand, indexCommand: IndexCommand, syncCommand: SyncCommand): void {
        this.searchCommand = searchCommand;
        this.indexCommand = indexCommand;
        this.syncCommand = syncCommand;
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        console.log('SemanticSearchViewProvider: resolveWebviewView called');

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = WebviewHelper.getHtmlContent(
            this._extensionUri,
            'src/webview/templates/semanticSearch.html',
            webviewView.webview
        );

        this.checkIndexStatusAndUpdateWebview(webviewView.webview);

        this.sendCurrentConfig(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'checkIndex':
                        await this.checkIndexStatusAndUpdateWebview(webviewView.webview);
                        return;

                    case 'getConfig':
                        this.sendCurrentConfig(webviewView.webview);
                        return;

                    case 'saveConfig':
                        await this.saveConfig(message.config, webviewView.webview);
                        return;

                    case 'testEmbedding':
                        await this.testEmbedding(message.config, webviewView.webview);
                        return;

                    case 'search':
                        try {
                            const searchResults = await this.searchCommand.executeForWebview(
                                message.text,
                                50,
                                Array.isArray(message.fileExtensions) ? message.fileExtensions : []
                            );

                            const results = this.convertSearchResultsToWebviewFormat(searchResults);

                            webviewView.webview.postMessage({
                                command: 'showResults',
                                results: results,
                                query: message.text
                            });

                            vscode.window.showInformationMessage(`Found ${results.length} results for: "${message.text}"`);
                        } catch (error) {
                            console.error('Search failed:', error);
                            vscode.window.showErrorMessage(`Search failed: ${error}`);
                            webviewView.webview.postMessage({
                                command: 'showResults',
                                results: [],
                                query: message.text
                            });
                        }
                        return;

                    case 'index':
                        try {
                            await this.indexCommand.execute();
                            webviewView.webview.postMessage({
                                command: 'indexComplete'
                            });
                            await this.checkIndexStatusAndUpdateWebview(webviewView.webview);
                        } catch (error) {
                            console.error('Indexing error:', error);
                            webviewView.webview.postMessage({
                                command: 'indexComplete'
                            });
                        }
                        return;

                    case 'openFile':
                        try {
                            const workspaceFolders = vscode.workspace.workspaceFolders;
                            const workspaceRoot = workspaceFolders ? workspaceFolders[0].uri.fsPath : '';
                            const absPath = path.join(workspaceRoot, message.relativePath);
                            const uri = vscode.Uri.file(absPath);
                            const document = await vscode.workspace.openTextDocument(uri);
                            const editor = await vscode.window.showTextDocument(document);

                            if (message.startLine !== undefined && message.endLine !== undefined) {
                                const startLine = Math.max(0, message.startLine - 1);
                                const endLine = Math.max(0, message.endLine - 1);
                                const range = new vscode.Range(startLine, 0, endLine, Number.MAX_SAFE_INTEGER);
                                editor.selection = new vscode.Selection(range.start, range.end);
                                editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
                            } else if (message.line !== undefined) {
                                const line = Math.max(0, message.line - 1);
                                const range = new vscode.Range(line, 0, line, 0);
                                editor.selection = new vscode.Selection(range.start, range.end);
                                editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
                            }
                        } catch (error) {
                            vscode.window.showErrorMessage(`Failed to open file: ${message.relativePath}`);
                        }
                        return;
                }
            },
            undefined,
            []
        );
    }

    private convertSearchResultsToWebviewFormat(searchResults: any[]): any[] {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const baseWorkspacePath = workspaceFolders ? workspaceFolders[0].uri.fsPath : '/tmp';

        return searchResults.map(result => {
            let filePath = result.relativePath;
            if (result.relativePath && !result.relativePath.startsWith('/') && !result.relativePath.includes(':')) {
                filePath = `${baseWorkspacePath}/${result.relativePath}`;
            }

            let displayPath = result.relativePath;

            const truncatedContent = result.content && result.content.length <= 150
                ? result.content
                : (result.content || '').substring(0, 150) + '...';

            return {
                file: displayPath,
                filePath: filePath,
                relativePath: result.relativePath,
                line: result.startLine,
                preview: truncatedContent,
                context: `1 match in ${displayPath}`,
                score: result.score,
                startLine: result.startLine,
                endLine: result.endLine
            };
        });
    }

    private async checkIndexStatusAndUpdateWebview(webview: vscode.Webview): Promise<void> {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                webview.postMessage({
                    command: 'updateIndexStatus',
                    hasIndex: false
                });
                return;
            }

            const codebasePath = workspaceFolders[0].uri.fsPath;
            const hasIndex = await this.searchCommand.hasIndex(codebasePath);

            webview.postMessage({
                command: 'updateIndexStatus',
                hasIndex: hasIndex
            });
        } catch (error) {
            console.error('Failed to check index status:', error);
            webview.postMessage({
                command: 'updateIndexStatus',
                hasIndex: false
            });
        }
    }

    private sendCurrentConfig(webview: vscode.Webview) {
        const config = this.configManager.getEmbeddingProviderConfig();
        const milvusConfig = this.configManager.getMilvusConfig();
        const splitterConfig = this.configManager.getSplitterConfig();
        const supportedProviders = ConfigManager.getSupportedProviders();

        webview.postMessage({
            command: 'configData',
            config: config,
            milvusConfig: milvusConfig,
            splitterConfig: splitterConfig,
            supportedProviders: supportedProviders
        });
    }

    private async saveConfig(configData: any, webview: vscode.Webview) {
        try {
            const embeddingConfig: EmbeddingProviderConfig = {
                provider: configData.provider,
                config: configData.config
            };
            await this.configManager.saveEmbeddingProviderConfig(embeddingConfig);

            if (configData.milvusConfig) {
                await this.configManager.saveMilvusConfig(configData.milvusConfig);
            }

            if (configData.splitterConfig) {
                await this.configManager.saveSplitterConfig(configData.splitterConfig);
            }

            await new Promise(resolve => setTimeout(resolve, 100));

            vscode.commands.executeCommand('semanticCodeSearch.reloadConfiguration');

            webview.postMessage({
                command: 'saveResult',
                success: true,
                message: 'Configuration saved successfully!'
            });

            vscode.window.showInformationMessage('Context configuration saved successfully!');
        } catch (error) {
            webview.postMessage({
                command: 'saveResult',
                success: false,
                message: `Save failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            });
        }
    }

    private async testEmbedding(embeddingConfig: any, webview: vscode.Webview) {
        try {
            const embedding = ConfigManager.createEmbeddingInstance(embeddingConfig.provider, embeddingConfig.config);
            await embedding.embed('test embedding connection');

            webview.postMessage({
                command: 'testResult',
                success: true,
                message: 'Embedding connection test successful!'
            });
        } catch (error) {
            webview.postMessage({
                command: 'testResult',
                success: false,
                message: `Embedding connection test failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            });
        }
    }
} 