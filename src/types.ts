export interface Question {
    text: string;
    options: string[];
}

export interface SurveyData {
    title: string;
    description: string;
    questions: Question[];
    createdAt: number;
}

export interface ResponseData {
    surveyId: number;
    answers: number[]; // index into options array per question
    respondedAt: number;
}

export interface SurveyListItem {
    id: number;
    cid: string;
    creator: string;
    responseCount: number;
    data?: SurveyData;
}
