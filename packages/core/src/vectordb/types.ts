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
    filterExpr?: string;
}

export interface HybridSearchRequest {
    data: number[] | string;
    anns_field: string;
    param: Record<string, any>;
    limit: number;
}

export interface HybridSearchOptions {
    rerank?: RerankStrategy;
    limit?: number;
    filterExpr?: string;
}

export interface RerankStrategy {
    strategy: 'rrf' | 'weighted';
    params?: Record<string, any>;
}

export interface VectorSearchResult {
    document: VectorDocument;
    score: number;
}

export interface HybridSearchResult {
    document: VectorDocument;
    score: number;
}

export interface VectorDatabase {
    createCollection(collectionName: string, dimension: number, description?: string): Promise<void>;

    createHybridCollection(collectionName: string, dimension: number, description?: string): Promise<void>;

    dropCollection(collectionName: string): Promise<void>;

    hasCollection(collectionName: string): Promise<boolean>;

    listCollections(): Promise<string[]>;

    insert(collectionName: string, documents: VectorDocument[]): Promise<void>;

    insertHybrid(collectionName: string, documents: VectorDocument[]): Promise<void>;

    search(collectionName: string, queryVector: number[], options?: SearchOptions): Promise<VectorSearchResult[]>;

    hybridSearch(collectionName: string, searchRequests: HybridSearchRequest[], options?: HybridSearchOptions): Promise<HybridSearchResult[]>;

    delete(collectionName: string, ids: string[]): Promise<void>;

    query(collectionName: string, filter: string, outputFields: string[], limit?: number): Promise<Record<string, any>[]>;

    // Resolves true when a new collection can be created, false when the account limit is reached.
    checkCollectionLimit(): Promise<boolean>;
}

export const COLLECTION_LIMIT_MESSAGE = "[Error]: Your Zilliz Cloud account has hit its collection limit. To continue creating collections, you'll need to expand your capacity. We recommend visiting https://zilliz.com/pricing to explore options for dedicated or serverless clusters."; 