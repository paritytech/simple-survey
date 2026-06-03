export { getSurveysAddress, getSurveysInterface, isSurveysDeployed } from "./config.ts";
export { getAPI, type ChainAPI } from "./chain.ts";
export {
    getSurveyCount,
    getSurveyCid,
    getSurveyCreator,
    getResponseCount,
    getResponseCid,
    hasResponded,
    getMappedH160,
    createSurvey,
    submitResponse,
} from "./surveys.ts";
