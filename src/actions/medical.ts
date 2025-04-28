'use server'

import { writeFile, readFile } from 'fs/promises'
import { join, basename, extname } from 'path'
import { performOCR } from '@/helpers/openl-ocr'

export async function submitMedicalData(formData: FormData): Promise<{ text: string; files: string[]; ocrResults: { [key: string]: string } }> {
  try {
    const text = formData.get('text') as string
    const files = formData.getAll('files') as File[]
    const uploadedFiles: string[] = []
    const ocrResults: { [key: string]: string } = {}

    // Process each file
    for (const file of files) {
      if (file.size === 0) continue

      const bytes = await file.arrayBuffer()
      const buffer = Buffer.from(bytes)

      // Create a unique filename
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`
      const filename = `${uniqueSuffix}-${file.name}`
      const filepath = join(process.cwd(), 'public', 'uploads', filename)

      // Save the file
      await writeFile(filepath, buffer)

      // Add the public URL to our list
      uploadedFiles.push(`/uploads/${filename}`)

      // Process image with OCR if it's an image file
      const fileExtension = extname(file.name).toLowerCase().slice(1)
      if (['jpg', 'jpeg', 'png', 'gif', 'bmp'].includes(fileExtension)) {
        try {
          // Use the existing OCR functionality
          const result = await performOCR(filepath, process.pid.toString(), {
            batchSize: 1,
            batchDelay: 0,
            fileExtensions: [fileExtension],
            staleLockTime: 30,
            useProxy: true,
            proxyTimeout: 30,
            proxyRetries: 3
          })

          if (result.success) {
            // Read the OCR text file
            const ocrTextPath = join(process.cwd(), 'public', 'uploads', `${basename(filename, extname(filename))}.txt`)
            const ocrText = await readFile(ocrTextPath, 'utf-8')
            ocrResults[filename] = ocrText
          } else {
            ocrResults[filename] = 'OCR processing failed: ' + (result.error || 'Unknown error')
          }
        } catch (error) {
          console.error(`OCR processing failed for ${filename}:`, error)
          ocrResults[filename] = 'OCR processing failed: ' + (error instanceof Error ? error.message : 'Unknown error')
        }
      }
    }

    return {
      text,
      files: uploadedFiles,
      ocrResults
    }
  } catch (error) {
    console.error('Error processing submission:', error)
    throw new Error('Failed to process submission')
  }
} 