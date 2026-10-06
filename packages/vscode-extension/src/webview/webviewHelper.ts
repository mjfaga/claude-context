import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class WebviewHelper {

    static getHtmlContent(extensionUri: vscode.Uri, templatePath: string, webview: vscode.Webview): string {
        const htmlPath = path.join(extensionUri.fsPath, templatePath);

        try {
            let htmlContent = fs.readFileSync(htmlPath, 'utf8');

            if (htmlContent.includes('{{styleUri}}') || htmlContent.includes('{{scriptUri}}')) {
                const styleUri = webview.asWebviewUri(
                    vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'styles', 'semanticSearch.css')
                );
                const scriptUri = webview.asWebviewUri(
                    vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'scripts', 'semanticSearch.js')
                );

                htmlContent = htmlContent
                    .replace('{{styleUri}}', styleUri.toString())
                    .replace('{{scriptUri}}', scriptUri.toString());
            }

            return htmlContent;
        } catch (error) {
            console.error('Failed to read HTML template:', error);
            return this.getFallbackHtml();
        }
    }

    private static getFallbackHtml(): string {
        return `
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Semantic Search</title>
			</head>
			<body>
				<h3>Semantic Search</h3>
				<p>Error loading template. Please check console for details.</p>
			</body>
			</html>
		`;
    }
} 