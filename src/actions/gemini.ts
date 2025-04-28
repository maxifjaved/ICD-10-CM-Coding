'use server';

import { GoogleGenerativeAI } from '@google/generative-ai';

const GENAI_API_KEY = process.env.GENAI_API_KEY!;
const genAI = new GoogleGenerativeAI(GENAI_API_KEY);

export async function extractProcedures(question: string, ocrText?: string) {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const contextText = ocrText 
        ? `User Question: ${question}\n\nOCR Text from Medical Document:\n${ocrText}`
        : `User Question: ${question}`;

    const procedurePrompt = `
# ROLE: Medical Diagnosis Extractor AI

## PRIMARY GOAL
Carefully and accurately extract the specific **Pre-Procedure Diagnosis** or **Diagnosis** listed in the provided medical text. Focus *only* on the explicitly stated diagnosis, not the procedure title or other information.

## CONTEXT
-   **Full Documentation Context:** ${contextText}

## CRITICAL EXTRACTION GUIDELINES (Adhere Strictly)
1.  **Target:** Extract ONLY the text explicitly labeled as "Pre-Procedure Diagnosis" or "Diagnosis".
2.  **Exclusion:** DO NOT extract the procedure title/name (e.g., "Fluoroscopically Guided Injection").
3.  **Content:** Include the exact diagnosis name(s) and any associated details like anatomical location/laterality if provided *within the diagnosis field itself*.
4.  **Specificity:** Extract the information exactly as presented in the diagnosis field. Do not summarize, interpret, or assume.
5.  **Multiple Diagnoses:** If multiple distinct diagnoses are listed under the relevant heading, extract each one.
6.  **No Diagnosis:** If no text is clearly identifiable as "Pre-Procedure Diagnosis" or "Diagnosis", state exactly: "No clearly documented pre-procedure diagnosis found in the text."

## OUTPUT REQUIREMENTS

### 1. Format (Exact Structure Required)
    -   List the extracted diagnosis/diagnoses concisely.
    -   If multiple, list each on a new line, perhaps preceded by a hyphen or bullet.
    -   If none found, use the exact phrase from Guideline #6.

### 2. Tone and Language
    -   Direct and factual.
    -   No greetings, apologies, explanations, or extraneous commentary.

## FINAL CHECK
Review your extracted text to ensure it strictly represents only the explicitly stated Pre-Procedure Diagnosis/Diagnosis from the document and adheres to all guidelines.

Answer:
`;

    const procedureResult = await model.generateContent(procedurePrompt);
    return procedureResult.response.text();
}

export async function queryGenAiMedicalCoding(question: string, procedures: string, ocrText?: string) {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const contextText = ocrText 
        ? `User Question: ${question}\n\nDiagnosis Extracted: ${procedures}\n\nOCR Text from Medical Document:\n${ocrText}`
        : `User Question: ${question}\n\nDiagnosis Extracted: ${procedures}`;

    const answerPrompt = `
# ROLE: Medical Coding Assistant AI

## PRIMARY GOAL
Accurately assign ICD-10-CM, CPT, and HCPCS codes based *strictly* on the provided clinical documentation ('Diagnosis Extracted', 'User Question', 'OCR Text') and adhere *exactly* to the guidelines below.

## CONTEXT
-   **Diagnosis Extracted:** ${procedures}
-   **Full Documentation Context:** ${contextText}

## CRITICAL CODING GUIDELINES (Adhere Strictly)

### 1. ICD-10-CM Coding
    -   **Source:** MUST use **ONLY** active codes from https://www.icd10data.com/ICD10CM/Codes. NO other sources.
    -   **Basis:** Code **strictly** based on the 'Diagnosis Extracted'.
    -   **Specificity:** Find the **MOST specific** code on icd10data.com matching the *full* 'Diagnosis Extracted', including anatomical location.
    -   **Handling General Diagnoses:** If 'Diagnosis Extracted' is general (e.g., 'Cervical Spondylosis') and lacks qualifiers (like myelopathy/radiculopathy), you MUST actively search icd10data.com for the specific code *'without myelopathy or radiculopathy'* for that location (e.g., M47.812 for cervical). DO NOT use 'unspecified' codes (like M47.9) unless absolutely no more specific code exists on the required source site.

### 2. CPT Coding
    -   **Basis:** Code procedures described in the full 'Full Documentation Context'.
    -   **Modifiers - Bilateral (-50):** If the procedure description *explicitly* states 'BILATERAL', you MUST append the '-50' modifier to the relevant CPT code(s).
    -   **Modifiers - Other:** Apply other necessary CPT modifiers based on documentation (e.g., laterality if not bilateral, anatomical site).
    -   **Radiological Guidance:** If guidance (e.g., 'Fluoroscopically Guided', 'fluoroscopy') is explicitly mentioned, you MUST include the appropriate CPT code (e.g., 77003 for fluoroscopy) on a separate line. Append the '-26' modifier (Professional Component) to the guidance code.

### 3. HCPCS Coding
    -   **Basis:** Code drugs, supplies, or specific procedures from the 'Full Documentation Context'.
    -   **Units:** Include correct units for drugs/supplies (e.g., J3301 for Triamcinolone 10mg, units based on total mg administered).
    -   **Modifiers:** Include any necessary modifiers.
    -   **Verification:** Ensure codes are active and not retired.

## OUTPUT REQUIREMENTS

### 1. Format (Exact Structure Required)
    1.  **DIAGNOSIS/PROCEDURE SUMMARY:**
        _Brief summary: Primary diagnosis from 'Diagnosis Extracted'; Procedures including laterality, levels, and guidance method from 'Full Documentation Context'._
    2.  **CODE ASSIGNMENTS:**
        -   **ICD-10-CM:**
            -   _Code_ – _Description_ (Must be MOST specific match for 'Diagnosis Extracted' from icd10data.com, per Guideline #1)
        -   **CPT:**
            -   _Code_[_-Modifier(s)_] – _Description_ (Ensure -50 is added if bilateral)
            -   _GuidanceCode_[_-26_] – _Description_ (Add this line ONLY if guidance used)
        -   **HCPCS:**
            -   _Code_[_Modifier_] – _Description_ (units: _#_)
    3.  **CODING RATIONALE:**
        _Explain the reason for selecting **each** code AND **each** modifier. Reference specific details from the documentation (e.g., 'Diagnosis Extracted', 'bilateral procedure description', 'fluoroscopic guidance mentioned'). Justify ICD-10-CM specificity based on Guideline #1._
    4.  **DOCUMENTATION NOTES:**
        _List any missing/ambiguous details needed for more precise coding._

### 2. Tone and Language
    -   Professional and concise.
    -   No greetings, apologies, or extraneous commentary.
    -   Focus solely on providing accurate coding information per the guidelines.

## FINAL CHECK
Review your generated response to ensure **strict adherence** to ALL guidelines, especially ICD-10-CM specificity, CPT modifiers (-50, -26), inclusion of guidance codes, and the exact output format before concluding.

${contextText}

Answer:
`;

    const answerResult = await model.generateContent(answerPrompt);
    return answerResult.response.text();
}