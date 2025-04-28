"use client";

import { submitMedicalData } from "@/actions/medical";
import { useState } from "react";

export default function Home() {
  const [result, setResult] = useState<{
    text: string;
    files: string[];
    ocrResults: { [key: string]: string };
  } | null>(null);

  async function handleSubmit(formData: FormData) {
    const response = await submitMedicalData(formData);
    setResult(response);
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">MedAi</h1>

        <form action={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="text" className="block text-sm font-medium mb-2">
              Medical Text
            </label>
            <textarea
              id="text"
              name="text"
              rows={6}
              className="w-full p-3 border border-foreground/20 rounded-lg bg-background"
              placeholder="Enter your medical text here..."
              required
            />
          </div>

          <div>
            <label htmlFor="files" className="block text-sm font-medium mb-2">
              Upload Files
            </label>
            <input
              type="file"
              id="files"
              name="files"
              multiple
              className="w-full p-3 border border-foreground/20 rounded-lg bg-background"
              accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png,.gif,.bmp"
            />
            <p className="mt-1 text-sm text-foreground/60">
              Supported formats: PDF, DOC, DOCX, TXT, JPG, PNG, GIF, BMP
            </p>
          </div>

          <button
            type="submit"
            className="w-full py-3 px-4 bg-primary text-white rounded-lg hover:bg-primary-light transition-colors"
          >
            Submit
          </button>
        </form>

        {result && (
          <div className="mt-8 p-6 border border-foreground/20 rounded-lg">
            <h2 className="text-xl font-semibold mb-4">Submission Results</h2>

            <div className="mb-4">
              <h3 className="text-sm font-medium mb-2">Submitted Text:</h3>
              <p className="text-foreground/80 whitespace-pre-wrap">
                {result.text}
              </p>
            </div>

            {result.files.length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-medium mb-2">Uploaded Files:</h3>
                <ul className="space-y-2">
                  {result.files.map((file, index) => (
                    <li key={index} className="space-y-2">
                      <a
                        href={file}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {file.split("/").pop()}
                      </a>
                      {result.ocrResults[file.split("/").pop()!] && (
                        <div className="pl-4 border-l-2 border-primary/20">
                          <h4 className="text-sm font-medium text-foreground/70">
                            OCR Result:
                          </h4>
                          <p className="text-sm text-foreground/60 whitespace-pre-wrap">
                            {result.ocrResults[file.split("/").pop()!]}
                          </p>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
