import axios from 'axios';

const ANALYZER_URL = process.env.PRESIDIO_ANALYZER_URL || 'http://localhost:5001';
const ANONYMIZER_URL = process.env.PRESIDIO_ANONYMIZER_URL || 'http://localhost:5002';

export interface AnalyzerResult {
    entity_type: string;
    start: number;
    end: number;
    score: number;
    analysis_explanation?: any;
}

export interface AnonymizeResponse {
    text: string;
    items: Array<{
        start: number;
        end: number;
        entity_type: string;
        text: string;
        operator: string;
    }>;
}

export async function analyzePII(text: string, language: string = 'en'): Promise<AnalyzerResult[]> {
    const response = await axios.post(`${ANALYZER_URL}/analyze`, {
        text,
        language
    });
    return response.data;
}

export async function anonymizePII(
    text: string,
    analyzerResults: AnalyzerResult[],
    anonymizers?: Record<string, any>
): Promise<AnonymizeResponse> {
    const response = await axios.post(`${ANONYMIZER_URL}/anonymize`, {
        text,
        analyzer_results: analyzerResults,
        anonymizers: anonymizers || { DEFAULT: { type: 'replace', new_value: '<REDACTED>' } }
    });
    return response.data;
}

export async function redactPII(text: string, language: string = 'en', anonymizers?: Record<string, any>): Promise<AnonymizeResponse> {
    const results = await analyzePII(text, language);
    return anonymizePII(text, results, anonymizers);
}
