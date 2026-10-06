import { MilvusConfig, MilvusConfigManager } from '../config/milvusConfig';

import { VectorDocument, VectorSearchResult, SearchOptions } from '../stubs/milvus-vectordb-stub';
import { MilvusRestfulVectorDatabase } from '../stubs/milvus-vectordb-stub';

export interface CodeChunk {
    id: string;
    content: string;
    relativePath: string;
    startLine: number;
    endLine: number;
    fileExtension: string;
    metadata: string;
    vector?: number[];
}

export interface SearchResult {
    id: string;
    content: string;
    relativePath: string;
    startLine: number;
    endLine: number;
    fileExtension: string;
    metadata: string;
    score: number;
}

export class ChromeMilvusAdapter {
    private milvusDb: MilvusRestfulVectorDatabase | null = null;
    private collectionName: string;

    constructor(collectionName: string = 'chrome_code_chunks') {
        this.collectionName = collectionName;
    }

    async initialize(): Promise<void> {
        const config = await MilvusConfigManager.getMilvusConfig();
        if (!config || !MilvusConfigManager.validateMilvusConfig(config)) {
            throw new Error('Invalid or missing Milvus configuration');
        }

        const coreConfig = {
            address: config.address,
            token: config.token,
            username: config.username,
            password: config.password,
            database: config.database
        };

        this.milvusDb = new MilvusRestfulVectorDatabase(coreConfig);
        console.log('🔌 Chrome Milvus adapter initialized');
    }

    async createCollection(dimension: number = 1536): Promise<void> {
        if (!this.milvusDb) {
            throw new Error('Milvus not initialized');
        }

        try {
            await this.milvusDb.createCollection(this.collectionName, dimension, 'Chrome extension code chunks');
            console.log(`✅ Collection '${this.collectionName}' created successfully`);
        } catch (error) {
            console.error('❌ Failed to create collection:', error);
            throw error;
        }
    }

    async collectionExists(): Promise<boolean> {
        if (!this.milvusDb) {
            return false;
        }

        try {
            return await this.milvusDb.hasCollection(this.collectionName);
        } catch (error) {
            console.error('Error checking collection existence:', error);
            return false;
        }
    }

    async insertChunks(chunks: CodeChunk[]): Promise<void> {
        if (!this.milvusDb) {
            throw new Error('Milvus not initialized');
        }

        if (chunks.length === 0) {
            return;
        }

        const documents = chunks.map(chunk => ({
            id: chunk.id,
            vector: chunk.vector || [],
            content: chunk.content,
            relativePath: chunk.relativePath,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            fileExtension: chunk.fileExtension,
            metadata: JSON.parse(chunk.metadata || '{}')
        }));

        try {
            await this.milvusDb.insert(this.collectionName, documents);
            console.log(`✅ Inserted ${documents.length} chunks into Milvus`);
        } catch (error) {
            console.error('❌ Failed to insert chunks:', error);
            throw error;
        }
    }

    async searchSimilar(queryVector: number[], limit: number = 10, threshold: number = 0.3): Promise<SearchResult[]> {
        if (!this.milvusDb) {
            throw new Error('Milvus not initialized');
        }

        try {
            const searchOptions: SearchOptions = {
                topK: limit,
                threshold
            };

            const results = await this.milvusDb.search(this.collectionName, queryVector, searchOptions);

            const searchResults = results.map(result => ({
                id: result.document.id,
                content: result.document.content,
                relativePath: result.document.relativePath,
                startLine: result.document.startLine,
                endLine: result.document.endLine,
                fileExtension: result.document.fileExtension,
                metadata: JSON.stringify(result.document.metadata),
                score: result.score
            }));

            searchResults.sort((a, b) => b.score - a.score);

            console.log(`🔍 Found ${searchResults.length} results with cosine similarity scores:`, 
                searchResults.slice(0, 5).map(r => ({ 
                    path: r.relativePath.split('/').pop(), 
                    score: r.score.toFixed(4),
                    lines: `${r.startLine}-${r.endLine}`
                })));

            return searchResults;
        } catch (error) {
            console.error('❌ Search failed:', error);
            throw error;
        }
    }

    async clearCollection(): Promise<void> {
        if (!this.milvusDb) {
            throw new Error('Milvus not initialized');
        }

        try {
            await this.milvusDb.dropCollection(this.collectionName);
            console.log(`✅ Collection '${this.collectionName}' cleared successfully`);
        } catch (error) {
            console.error('❌ Failed to clear collection:', error);
            throw error;
        }
    }

    async getCollectionStats(): Promise<{ totalEntities: number } | null> {
        if (!this.milvusDb) {
            return null;
        }

        try {
            const stats = await this.milvusDb.getCollectionStats(this.collectionName);
            return {
                totalEntities: stats.entityCount || 0
            };
        } catch (error) {
            console.error('❌ Failed to get collection stats:', error);
            return null;
        }
    }

    async testConnection(): Promise<boolean> {
        try {
            const config = await MilvusConfigManager.getMilvusConfig();
            if (!config) {
                console.error('No Milvus configuration found');
                throw new Error('No Milvus configuration found');
            }

            if (!MilvusConfigManager.validateMilvusConfig(config)) {
                console.error('Invalid Milvus configuration');
                throw new Error('Invalid Milvus configuration');
            }

            console.log('Testing connection with config:', { 
                address: config.address, 
                database: config.database,
                hasToken: !!config.token,
                hasUsername: !!config.username
            });

            const coreConfig = {
                address: config.address,
                token: config.token,
                username: config.username,
                password: config.password,
                database: config.database
            };

            const testDb = new MilvusRestfulVectorDatabase(coreConfig);
            
            try {
                await testDb.hasCollection('_test_connection_');
                console.log('Milvus connection test successful');
                return true;
            } catch (error) {
                console.error('Milvus connection test failed:', error);
                throw error;
            }

        } catch (error) {
            console.error('Connection test failed:', error);
            throw error;
        }
    }
}
