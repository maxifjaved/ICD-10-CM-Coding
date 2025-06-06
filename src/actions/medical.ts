'use server'

import { extname } from 'path'
import { performOCR } from '@/helpers/openl-ocr'
import { extractProcedures, queryGenAiMedicalCoding } from './gemini'

export async function submitMedicalData(formData: FormData): Promise<{ 
  text: string; 
  files: string[]; 
  ocrResults: { [key: string]: string }; 
  extractedProcedures?: string;
  medicalCoding?: string 
}> {
  try {
    const text = formData.get('text') as string
    const files = formData.getAll('files') as File[]
    const uploadedFiles: string[] = []
    const ocrResults: { [key: string]: string } = {}

    // Create a default proxy manager
    const proxyManager = {
      getProxy: async () => '',
      releaseProxy: () => {}
    }

    // Process each file
    for (const file of files) {
      if (file.size === 0) continue

      const bytes = await file.arrayBuffer()
      const buffer = Buffer.from(bytes)

      // Create a unique filename
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`
      const filename = `${uniqueSuffix}-${file.name}`
      
      // Add the filename to our list (we no longer save the file)
      uploadedFiles.push(filename)

      // Process image with OCR if it's an image file
      const fileExtension = extname(file.name).toLowerCase().slice(1)
      if (['jpg', 'jpeg', 'png', 'gif', 'bmp'].includes(fileExtension)) {
        try {
          // Use the in-memory OCR functionality
          const result = await performOCR(
            buffer,
            file.name,
            {
              batchSize: 1,
              delay: 0,
              extensions: [fileExtension],
              staleLock: false,
              proxy: '',
              proxyTimeout: 30,
              proxyRetries: 3
            },
            proxyManager
          )

          if (result.success && result.text) {
            ocrResults[filename] = result.text
          } else {
            ocrResults[filename] = 'OCR processing failed: ' + (result.error || 'Unknown error')
          }
        } catch (error) {
          console.error(`OCR processing failed for ${filename}:`, error)
          ocrResults[filename] = 'OCR processing failed: ' + (error instanceof Error ? error.message : 'Unknown error')
        }
      }
    }

    // Combine all OCR text with user-provided text
    const allOcrText = Object.values(ocrResults).join('\n\n')
    
    // First extract diagnosis
    let extractedProcedures: string | undefined
    let medicalCoding: string | undefined
    
    if (text || allOcrText) {
      try {
        // Step 1: Extract diagnosis from the text
        extractedProcedures = await extractProcedures(text, allOcrText)
        
        // Step 2: Generate medical coding based on the diagnosis
        if (extractedProcedures) {
          medicalCoding = await queryGenAiMedicalCoding(text, extractedProcedures, allOcrText)
        }
      } catch (error) {
        console.error('Error processing medical data:', error)
      }
    }

    return {
      text,
      files: uploadedFiles,
      ocrResults,
      extractedProcedures,
      medicalCoding
    }
  } catch (error) {
    console.error('Error processing submission:', error)
    throw new Error('Failed to process submission')
  }
} 