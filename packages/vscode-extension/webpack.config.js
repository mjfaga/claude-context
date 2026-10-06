const path = require('path');
const webpack = require('webpack');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
    target: 'node',
    mode: 'none',

    entry: './src/extension.ts',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'extension.js',
        libraryTarget: 'commonjs2'
    },
    cache: {
        type: 'filesystem',
        buildDependencies: {
            config: [__filename]
        }
    },
    devtool: 'nosources-source-map',
    externals: {
        vscode: 'commonjs vscode', // the vscode module is provided by the host and must be excluded
    },
    resolve: {
        extensions: ['.ts', '.js'],
        alias: {
            '@zilliz/claude-context-core': path.resolve(__dirname, '../core/dist/index.js'),
            '@zilliz/claude-context-core/dist/splitter': path.resolve(__dirname, '../core/dist/splitter'),
            '@zilliz/claude-context-core/dist/embedding': path.resolve(__dirname, '../core/dist/embedding'),
            '@zilliz/claude-context-core/dist/vectordb': path.resolve(__dirname, '../core/dist/vectordb')
        }
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: [
                    {
                        loader: 'ts-loader',
                        options: {
                            transpileOnly: true,
                            onlyCompileBundledFiles: true
                        }
                    }
                ]
            },
            {
                test: /\.wasm$/,
                type: 'webassembly/async'
            },
            {
                test: /tree-sitter.*\.wasm$/,
                type: 'asset/resource',
                generator: {
                    filename: 'wasm/[name][ext]'
                }
            }
        ]
    },
    experiments: {
        asyncWebAssembly: true
    },
    plugins: [
        new webpack.IgnorePlugin({
            resourceRegExp: /@zilliz\/milvus2-sdk-node/
        }),

        // Native tree-sitter breaks in the VSCode extension host; web-tree-sitter is bundled instead
        new webpack.IgnorePlugin({
            resourceRegExp: /^tree-sitter$/
        }),

        // The stub avoids importing the ignored Milvus SDK
        new webpack.NormalModuleReplacementPlugin(
            /.*milvus-vectordb(\.js)?$/,
            path.resolve(__dirname, 'src/stubs/milvus-vectordb-stub.js')
        ),

        // The AST splitter depends on native tree-sitter, so a stub replaces it
        new webpack.NormalModuleReplacementPlugin(
            /.*ast-splitter(\.js)?$/,
            path.resolve(__dirname, 'src/stubs/ast-splitter-stub.js')
        ),

        new CopyWebpackPlugin({
            patterns: [
                {
                    from: path.resolve(__dirname, 'node_modules/web-tree-sitter/tree-sitter.wasm'),
                    to: path.resolve(__dirname, 'dist/tree-sitter.wasm')
                },
                {
                    from: path.resolve(__dirname, 'wasm'),
                    to: path.resolve(__dirname, 'dist/wasm'),
                    globOptions: {
                        ignore: ['**/.DS_Store']
                    }
                }
            ]
        })
    ]
};