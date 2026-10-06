export interface VectorDocument {
    id: string;
    vector: number[];
    content: string;
    relativePath: string;
    startLine: number;
    endLine: number;
    fileExtension: string;
    metadata: Record<string, any>;
}

export interface SearchOptions {
    topK?: number;
    filter?: Record<string, any>;
    threshold?: number;
}

export interface VectorSearchResult {
    document: VectorDocument;
    score: number;
}

export interface MilvusRestfulConfig {
    address: string;
    token?: string;
    username?: string;
    password?: string;
    database?: string;
}

export class MilvusRestfulVectorDatabase {
    private config: MilvusRestfulConfig;
    private baseUrl: string;

    constructor(config: MilvusRestfulConfig) {
        this.config = config;

        let address = config.address;
        if (!address.startsWith('http://') && !address.startsWith('https://')) {
            address = `http://${address}`;
        }

        this.baseUrl = address.replace(/\/$/, '') + '/v2/vectordb';
        console.log(`🔌 Connecting to Milvus REST API at: ${address}`);
    }

    private async makeRequest(endpoint: string, method: 'GET' | 'POST' = 'POST', data?: any): Promise<any> {
        const url = `${this.baseUrl}${endpoint}`;

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };

        if (this.config.token) {
            headers['Authorization'] = `Bearer ${this.config.token}`;
        } else if (this.config.username && this.config.password) {
            headers['Authorization'] = `Bearer ${this.config.username}:${this.config.password}`;
        }

        const requestOptions: RequestInit = {
            method,
            headers,
        };

        if (data && method === 'POST') {
            requestOptions.body = JSON.stringify(data);
        }

        try {
            console.log(`🔗 Making request to: ${url}`);
            const response = await fetch(url, requestOptions);

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`❌ HTTP error ${response.status}: ${response.statusText}`, errorText);
                throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
            }

            const result: any = await response.json();

            if (result.code !== 0 && result.code !== 200) {
                console.error(`❌ Milvus API error:`, result);
                throw new Error(`Milvus API error: ${result.message || 'Unknown error'}`);
            }

            console.log(`✅ Request successful:`, { endpoint, method });
            return result;
        } catch (error) {
            console.error(`❌ Milvus REST API request failed to ${url}:`, error);

            if (error instanceof TypeError && error.message.includes('fetch')) {
                throw new Error(`Network error: Unable to connect to Milvus server at ${this.config.address}. Please check the server address and ensure it's running.`);
            }

            throw error;
        }
    }

    async createCollection(collectionName: string, dimension: number, description?: string): Promise<void> {
        try {
            const collectionSchema = {
                collectionName,
                dbName: this.config.database,
                schema: {
                    enableDynamicField: false,
                    fields: [
                        {
                            fieldName: "id",
                            dataType: "VarChar",
                            isPrimary: true,
                            elementTypeParams: {
                                max_length: 512
                            }
                        },
                        {
                            fieldName: "vector",
                            dataType: "FloatVector",
                            elementTypeParams: {
                                dim: dimension
                            }
                        },
                        {
                            fieldName: "content",
                            dataType: "VarChar",
                            elementTypeParams: {
                                max_length: 65535
                            }
                        },
                        {
                            fieldName: "relativePath",
                            dataType: "VarChar",
                            elementTypeParams: {
                                max_length: 1024
                            }
                        },
                        {
                            fieldName: "startLine",
                            dataType: "Int64"
                        },
                        {
                            fieldName: "endLine",
                            dataType: "Int64"
                        },
                        {
                            fieldName: "fileExtension",
                            dataType: "VarChar",
                            elementTypeParams: {
                                max_length: 32
                            }
                        },
                        {
                            fieldName: "metadata",
                            dataType: "VarChar",
                            elementTypeParams: {
                                max_length: 65535
                            }
                        }
                    ]
                }
            };

            await createCollectionWithLimitCheck(this.makeRequest.bind(this), collectionSchema);

            await this.createIndex(collectionName);

            await this.loadCollection(collectionName);

        } catch (error) {
            console.error(`❌ Failed to create collection '${collectionName}':`, error);
            throw error;
        }
    }

    private async createIndex(collectionName: string): Promise<void> {
        const indexParams = {
            collectionName,
            dbName: this.config.database,
            indexParams: [
                {
                    fieldName: "vector",
                    indexName: "vector_index",
                    metricType: "COSINE",
                    index_type: "AUTOINDEX"
                }
            ]
        };

        console.log('📊 Creating index with COSINE metric for collection:', collectionName);
        await this.makeRequest('/indexes/create', 'POST', indexParams);
        console.log('✅ Index created successfully with COSINE similarity metric');
    }

    private async loadCollection(collectionName: string): Promise<void> {
        await this.makeRequest('/collections/load', 'POST', {
            collectionName,
            dbName: this.config.database
        });
    }

    async dropCollection(collectionName: string): Promise<void> {
        try {
            await this.makeRequest('/collections/drop', 'POST', {
                collectionName,
                dbName: this.config.database
            });
        } catch (error) {
            console.error(`❌ Failed to drop collection '${collectionName}':`, error);
            throw error;
        }
    }

    async hasCollection(collectionName: string): Promise<boolean> {
        try {
            const response = await this.makeRequest('/collections/has', 'POST', {
                collectionName,
                dbName: this.config.database
            });

            return response.data?.has || false;
        } catch (error) {
            console.error(`❌ Failed to check collection '${collectionName}' existence:`, error);
            throw error;
        }
    }

    async insert(collectionName: string, documents: VectorDocument[]): Promise<void> {
        try {
            const data = documents.map(doc => ({
                id: doc.id,
                vector: doc.vector,
                content: doc.content,
                relativePath: doc.relativePath,
                startLine: doc.startLine,
                endLine: doc.endLine,
                fileExtension: doc.fileExtension,
                metadata: JSON.stringify(doc.metadata)
            }));

            const insertRequest = {
                collectionName,
                data,
                dbName: this.config.database
            };

            await this.makeRequest('/entities/insert', 'POST', insertRequest);

        } catch (error) {
            console.error(`❌ Failed to insert documents into collection '${collectionName}':`, error);
            throw error;
        }
    }

    async search(collectionName: string, queryVector: number[], options?: SearchOptions): Promise<VectorSearchResult[]> {
        const topK = options?.topK || 10;

        try {
            const searchRequest = {
                collectionName,
                dbName: this.config.database,
                data: [queryVector],
                annsField: "vector",
                limit: topK,
                outputFields: [
                    "content",
                    "relativePath",
                    "startLine",
                    "endLine",
                    "fileExtension",
                    "metadata"
                ],
                searchParams: {
                    metricType: "COSINE",
                    params: {}
                }
            };

            const response = await this.makeRequest('/entities/search', 'POST', searchRequest);

            const results: VectorSearchResult[] = (response.data || []).map((item: any) => {
                let metadata = {};
                try {
                    metadata = JSON.parse(item.metadata || '{}');
                } catch (error) {
                    console.warn(`Failed to parse metadata for item ${item.id}:`, error);
                    metadata = {};
                }

                return {
                    document: {
                        id: item.id?.toString() || '',
                        vector: queryVector,
                        content: item.content || '',
                        relativePath: item.relativePath || '',
                        startLine: item.startLine || 0,
                        endLine: item.endLine || 0,
                        fileExtension: item.fileExtension || '',
                        metadata: metadata
                    },
                    score: Math.max(0, Math.min(1, 1 - (item.distance || 1)))
                };
            });

            const filteredResults = options?.threshold !== undefined
                ? results.filter(result => result.score >= options.threshold!)
                : results;

            const sortedResults = filteredResults.sort((a, b) => b.score - a.score);

            return sortedResults;

        } catch (error) {
            console.error(`❌ Failed to search in collection '${collectionName}':`, error);
            throw error;
        }
    }

    async delete(collectionName: string, ids: string[]): Promise<void> {
        try {
            const filter = `id in [${ids.map(id => `"${id}"`).join(', ')}]`;

            const deleteRequest = {
                collectionName,
                filter,
                dbName: this.config.database
            };

            await this.makeRequest('/entities/delete', 'POST', deleteRequest);

        } catch (error) {
            console.error(`❌ Failed to delete documents from collection '${collectionName}':`, error);
            throw error;
        }
    }

    async getCollectionStats(collectionName: string): Promise<{ entityCount: number }> {
        try {
            const response = await this.makeRequest('/collections/describe', 'POST', {
                collectionName,
                dbName: this.config.database
            });

            // The entity count field name varies by Milvus version.
            const entityCount = response.data?.numEntities || response.data?.entityCount || 0;

            return { entityCount };
        } catch (error) {
            console.error(`❌ Failed to get collection stats for '${collectionName}':`, error);
            return { entityCount: 0 };
        }
    }
}

export const COLLECTION_LIMIT_MESSAGE = "[Error]: Your Zilliz Cloud account has hit its collection limit. To continue creating collections, you'll need to expand your capacity. We recommend visiting https://zilliz.com/pricing to explore options for dedicated or serverless clusters.";

async function createCollectionWithLimitCheck(
    makeRequestFn: (endpoint: string, method: 'GET' | 'POST', data?: any) => Promise<any>,
    collectionSchema: any
): Promise<void> {
    try {
        await makeRequestFn('/collections/create', 'POST', collectionSchema);
    } catch (error: any) {
        const errorMessage = error.message || error.toString() || '';
        console.error(`❌ Error creating collection:`, errorMessage);
        if (/exceeded the limit number of collections/i.test(errorMessage)) {
            // Throws the message string itself, not an Error object.
            throw COLLECTION_LIMIT_MESSAGE;
        }
        throw error;
    }
}
