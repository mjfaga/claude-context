import { Context, MilvusVectorDatabase, MilvusRestfulVectorDatabase, AstCodeSplitter, LangChainCodeSplitter } from '@zilliz/claude-context-core';
import { envManager } from '@zilliz/claude-context-core';
import * as path from 'path';

try {
    require('dotenv').config();
} catch (error) {
    // dotenv is optional
}

async function main() {
    console.log('🚀 Context Real Usage Example');
    console.log('===============================');

    try {
        const useRestfulApi = false;
        const milvusAddress = envManager.get('MILVUS_ADDRESS') || 'localhost:19530';
        const milvusToken = envManager.get('MILVUS_TOKEN');
        const splitterType = envManager.get('SPLITTER_TYPE')?.toLowerCase() || 'ast';

        console.log(`🔧 Using ${useRestfulApi ? 'RESTful API' : 'gRPC'} implementation`);
        console.log(`🔌 Connecting to Milvus at: ${milvusAddress}`);

        let vectorDatabase;
        if (useRestfulApi) {
            vectorDatabase = new MilvusRestfulVectorDatabase({
                address: milvusAddress,
                ...(milvusToken && { token: milvusToken })
            });
        } else {
            vectorDatabase = new MilvusVectorDatabase({
                address: milvusAddress,
                ...(milvusToken && { token: milvusToken })
            });
        }

        let codeSplitter;
        if (splitterType === 'langchain') {
            codeSplitter = new LangChainCodeSplitter(1000, 200);
        } else {
            codeSplitter = new AstCodeSplitter(2500, 300);
        }
        const context = new Context({
            vectorDatabase,
            codeSplitter,
            supportedExtensions: ['.ts', '.js', '.py', '.java', '.cpp', '.go', '.rs']
        });

        console.log('\n📖 Starting to index codebase...');
        const codebasePath = path.join(__dirname, '../..');

        const hasExistingIndex = await context.hasIndex(codebasePath);
        if (hasExistingIndex) {
            console.log('🗑️  Existing index found, clearing it first...');
            await context.clearIndex(codebasePath);
        }

        const indexStats = await context.indexCodebase(codebasePath);

        console.log(`\n📊 Indexing stats: ${indexStats.indexedFiles} files, ${indexStats.totalChunks} code chunks`);

        console.log('\n🔍 Performing semantic search...');

        const queries = [
            'vector database operations',
            'code splitting functions',
            'embedding generation',
            'typescript interface definitions'
        ];

        for (const query of queries) {
            console.log(`\n🔎 Search: "${query}"`);
            const results = await context.semanticSearch(codebasePath, query, 3, 0.3);

            if (results.length > 0) {
                results.forEach((result, index) => {
                    console.log(`   ${index + 1}. Similarity: ${(result.score * 100).toFixed(2)}%`);
                    console.log(`      File: ${path.join(codebasePath, result.relativePath)}`);
                    console.log(`      Language: ${result.language}`);
                    console.log(`      Lines: ${result.startLine}-${result.endLine}`);
                    console.log(`      Preview: ${result.content.substring(0, 100)}...`);
                });
            } else {
                console.log('   No relevant results found');
            }
        }

        console.log('\n🎉 Example completed successfully!');

    } catch (error) {
        console.error('❌ Error occurred:', error);

        if (error instanceof Error) {
            if (error.message.includes('API key')) {
                console.log('\n💡 Please make sure to set the correct OPENAI_API_KEY environment variable');
                console.log('   Example: export OPENAI_API_KEY="your-actual-api-key"');
            } else if (error.message.includes('Milvus') || error.message.includes('connect')) {
                console.log('\n💡 Please make sure Milvus service is running');
                console.log('   - Default address: localhost:19530');
                console.log('   - Can be modified via MILVUS_ADDRESS environment variable');
                console.log('   - For RESTful API: set MILVUS_USE_RESTFUL=true');
                console.log('   - For gRPC (default): set MILVUS_USE_RESTFUL=false or leave unset');
                console.log('   - Start Milvus: docker run -p 19530:19530 milvusdb/milvus:latest');
            }

            console.log('\n💡 Environment Variables:');
            console.log('   - OPENAI_API_KEY: Your OpenAI API key (required)');
            console.log('   - OPENAI_BASE_URL: Custom OpenAI API endpoint (optional)');
            console.log('   - MILVUS_ADDRESS: Milvus server address (default: localhost:19530)');
            console.log('   - MILVUS_TOKEN: Milvus authentication token (optional)');
            console.log('   - SPLITTER_TYPE: Code splitter type - "ast" or "langchain" (default: ast)');
        }

        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

export { main };