// Mirror of LIMITS.maxQuestionChars in src/server/app.ts. The client can't import that module (it pulls the whole
// server and corpus into the bundle); test/web/limits.test.ts fails if the two ever differ.
export const MAX_QUESTION_CHARS = 2000;
