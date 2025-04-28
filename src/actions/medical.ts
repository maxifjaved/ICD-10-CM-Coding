'use server'

import { writeFile } from 'fs/promises'
import { join } from 'path'

export async function submitMedicalData(formData: FormData): Promise<{ text: string; files: string[] }> {
  try {
    const text = formData.get('text') as string
    const files = formData.getAll('files') as File[]
    const uploadedFiles: string[] = []

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
    }

    return {
      text,
      files: uploadedFiles
    }
  } catch (error) {
    console.error('Error processing submission:', error)
    throw new Error('Failed to process submission')
  }
} 