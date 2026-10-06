// Replaces milvus-vectordb.ts when bundling for VSCode to avoid the gRPC dependencies.

class MilvusVectorDatabase {
    constructor(config) {
        throw new Error('MilvusVectorDatabase (gRPC) is not available in VSCode extension. Use MilvusRestfulVectorDatabase instead.');
    }
}

module.exports = {
    MilvusVectorDatabase
}; 