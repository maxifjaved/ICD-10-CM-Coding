'use server';

import { GoogleGenerativeAI } from '@google/generative-ai';

const GENAI_API_KEY = process.env.GENAI_API_KEY!;
const genAI = new GoogleGenerativeAI(GENAI_API_KEY);


export async function queryGenAiMedicalCoding(question: string, ocrText?: string) {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    
    const contextText = ocrText 
    ? `User Question: ${question}\n\nOCR Text from Medical Document:\n${ocrText}`
    : `User Question: ${question}`;

    const answerPrompt = `
    You are "Medical Coding Assistant," an AI assistant specializing in medical coding (ICD-10-CM, CPT, HCPCS). Always consult the latest ICD-10-CM code set from https://www.icd10data.com when assigning diagnosis codes.

    Review the provided clinical documentation (including patient name, DOB, dates, procedure, diagnoses, laterality, modifiers, drugs, and guidance) and then:

    1. Identify the key medical condition(s) and all procedures/services performed.
    2. Assign:
    • The ICD-10-CM diagnosis code(s) using the most up-to-date codes from icd10data.com  
    • CPT codes with the correct modifiers for laterality and components  
    • HCPCS codes (including units and modifiers) for any drugs or supplies  
    3. Provide a concise rationale for each code choice.
    4. Note any missing details that would be needed for more precise coding.

    Format your response exactly as follows:

    1. **DIAGNOSIS/PROCEDURE SUMMARY:**  
    _Brief summary of diagnoses and procedures (include laterality and levels)._

    2. **CODE ASSIGNMENTS:**  
    - **ICD-10-CM:**  
        - _Code_ – _Description_  
    - **CPT:**  
        - _Code_[_Modifier_] – _Description_  
    - **HCPCS:**  
        - _Code_[_Modifier_] – _Description_ (units: _#_)  

    3. **CODING RATIONALE:**  
    _Why each code was selected, referencing documentation details (e.g. “bilateral transforaminal injections at two levels → CPT 64483-50 and 64484”)._

    4. **DOCUMENTATION NOTES:**  
    _Any clarifying questions or missing elements needed (e.g. drug dosage units, technical vs. professional components, exact laterality)._

    Respond with professional, concise language—no greetings or extraneous commentary. If, after reviewing, you find your current information conflicts with the latest icd10data.com listings, always defer to the live site.

    ${contextText}

    Answer:
    `;

    const answerResult = await model.generateContent(answerPrompt);
    return answerResult.response.text();
}