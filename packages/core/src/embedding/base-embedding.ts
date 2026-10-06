export interface EmbeddingVector {
    vector: number[];
    dimension: number;
}

export abstract class Embedding {
    protected abstract maxTokens: number;

    protected preprocessText(text: string): string {
        if (text === '') {
            return ' ';
        }

        // Approximates 4 characters per token for English text.
        const maxChars = this.maxTokens * 4;
        if (text.length > maxChars) {
            return text.substring(0, maxChars);
        }

        return text;
    }

    abstract detectDimension(testText?: string): Promise<number>;

    protected preprocessTexts(texts: string[]): string[] {
        return texts.map(text => this.preprocessText(text));
    }

    abstract embed(text: string): Promise<EmbeddingVector>;

    abstract embedBatch(texts: string[]): Promise<EmbeddingVector[]>;

    abstract getDimension(): number;

    abstract getProvider(): string;
} 