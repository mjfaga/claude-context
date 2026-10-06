import { GoogleGenAI } from '@google/genai';
import { Embedding, EmbeddingVector } from './base-embedding';

export interface GeminiEmbeddingConfig {
    model: string;
    apiKey: string;
    baseURL?: string;
    outputDimensionality?: number;
}

export class GeminiEmbedding extends Embedding {
    private client: GoogleGenAI;
    private config: GeminiEmbeddingConfig;
    private dimension: number = 3072;
    protected maxTokens: number = 2048;

    constructor(config: GeminiEmbeddingConfig) {
        super();
        this.config = config;
        this.client = new GoogleGenAI({
            apiKey: config.apiKey,
            ...(config.baseURL && {
                httpOptions: {
                    baseUrl: config.baseURL
                }
            }),
        });

        this.updateDimensionForModel(config.model || 'gemini-embedding-001');

        if (config.outputDimensionality) {
            this.dimension = config.outputDimensionality;
        }
    }

    private updateDimensionForModel(model: string): void {
        const supportedModels = GeminiEmbedding.getSupportedModels();
        const modelInfo = supportedModels[model];

        if (modelInfo) {
            this.dimension = modelInfo.dimension;
            this.maxTokens = modelInfo.contextLength;
        } else {
            this.dimension = 3072;
            this.maxTokens = 2048;
        }
    }

    async detectDimension(): Promise<number> {
        return this.dimension;
    }

    async embed(text: string): Promise<EmbeddingVector> {
        const processedText = this.preprocessText(text);
        const model = this.config.model || 'gemini-embedding-001';

        try {
            const response = await this.client.models.embedContent({
                model: model,
                contents: processedText,
                config: {
                    outputDimensionality: this.config.outputDimensionality || this.dimension,
                },
            });

            if (!response.embeddings || !response.embeddings[0] || !response.embeddings[0].values) {
                throw new Error('Gemini API returned invalid response');
            }

            return {
                vector: response.embeddings[0].values,
                dimension: response.embeddings[0].values.length
            };
        } catch (error) {
            throw new Error(`Gemini embedding failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
        const processedTexts = this.preprocessTexts(texts);
        const model = this.config.model || 'gemini-embedding-001';

        try {
            const response = await this.client.models.embedContent({
                model: model,
                contents: processedTexts,
                config: {
                    outputDimensionality: this.config.outputDimensionality || this.dimension,
                },
            });

            if (!response.embeddings) {
                throw new Error('Gemini API returned invalid response');
            }

            return response.embeddings.map((embedding: any) => {
                if (!embedding.values) {
                    throw new Error('Gemini API returned invalid embedding data');
                }
                return {
                    vector: embedding.values,
                    dimension: embedding.values.length
                };
            });
        } catch (error) {
            throw new Error(`Gemini batch embedding failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    getDimension(): number {
        return this.dimension;
    }

    getProvider(): string {
        return 'Gemini';
    }

    setModel(model: string): void {
        this.config.model = model;
        this.updateDimensionForModel(model);
    }

    setOutputDimensionality(dimension: number): void {
        this.config.outputDimensionality = dimension;
        this.dimension = dimension;
    }

    getClient(): GoogleGenAI {
        return this.client;
    }

    static getSupportedModels(): Record<string, { dimension: number; contextLength: number; description: string; supportedDimensions?: number[] }> {
        return {
            'gemini-embedding-001': {
                dimension: 3072,
                contextLength: 2048,
                description: 'Latest Gemini embedding model with state-of-the-art performance (recommended)',
                supportedDimensions: [3072, 1536, 768, 256]
            }
        };
    }

    getSupportedDimensions(): number[] {
        const modelInfo = GeminiEmbedding.getSupportedModels()[this.config.model || 'gemini-embedding-001'];
        return modelInfo?.supportedDimensions || [this.dimension];
    }

    isDimensionSupported(dimension: number): boolean {
        const supportedDimensions = this.getSupportedDimensions();
        return supportedDimensions.includes(dimension);
    }
}
