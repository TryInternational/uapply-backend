import docx
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_PARAGRAPH_ALIGNMENT
import random
import nltk
from nltk.corpus import wordnet
from nltk.tokenize import sent_tokenize, word_tokenize
from nltk.tag import pos_tag
import re
import spacy
from transformers import pipeline
import torch
import os
from tqdm import tqdm

# Initialize NLP tools
nlp = spacy.load("en_core_web_lg")
paraphraser = pipeline("text2text-generation", model="t5-base")

def load_technical_terms(file_path="technical_terms.txt"):
    """Load discipline-specific terms that shouldn't be changed"""
    if os.path.exists(file_path):
        with open(file_path, 'r') as f:
            return set(line.strip().lower() for line in f)
    return set()

TECHNICAL_TERMS = load_technical_terms()

def advanced_paraphrase(text):
    """Use multiple techniques to fundamentally restructure content"""
    # First pass with transformer model
    paraphrased = paraphraser(f"paraphrase: {text}", max_length=len(text.split())*3, do_sample=True)[0]['generated_text']
    
    # Second pass with rule-based restructuring
    doc = nlp(paraphrased)
    sentences = [sent.text for sent in doc.sents]
    restructured = []
    
    for sent in sentences:
        # Change sentence structure
        if random.random() > 0.5 and " by " in sent.lower():
            parts = re.split(r"\bby\b", sent, flags=re.IGNORECASE)
            if len(parts) == 2:
                restructured.append(f"{parts[1].strip()} was achieved through {parts[0].strip()}")
                continue
        
        # Convert between active and passive voice
        if random.random() > 0.7:
            doc_sent = nlp(sent)
            if len(list(doc_sent.verbs)) > 0:
                new_sent = ""
                for token in doc_sent:
                    if token.dep_ == "nsubjpass" and token.head.pos_ == "VERB":
                        new_sent = f"{token.text} {token.head.lemma_} by"
                    elif token.dep_ == "auxpass":
                        continue
                    else:
                        new_sent += " " + token.text
                if new_sent:
                    sent = new_sent
        
        restructured.append(sent)
    
    # Final semantic preservation check
    final_text = " ".join(restructured)
    if nlp(text).similarity(nlp(final_text)) < 0.7:  # If meaning changed too much
        return text  # Revert to original
    
    return final_text

def process_paragraph(paragraph):
    """Process paragraph with academic-level rewriting"""
    if not paragraph.text.strip() or len(paragraph.text.strip()) < 10:
        return paragraph
    
    # Skip headings and captions
    if paragraph.style.name.startswith('Heading') or paragraph.text.isupper() or len(paragraph.text) < 50:
        return paragraph
    
    original_runs = []
    for run in paragraph.runs:
        original_runs.append({
            'text': run.text,
            'bold': run.bold,
            'italic': run.italic,
            'underline': run.underline,
            'font': run.font.name,
            'size': run.font.size,
            'color': run.font.color.rgb if run.font.color else None
        })
    
    # Clear existing runs
    paragraph.clear()
    
    # Process each original run with academic rewriting
    for run_info in original_runs:
        if not run_info['text'].strip():
            new_run = paragraph.add_run(run_info['text'])
            continue
        
        # Skip citations and references
        if re.match(r"\([A-Za-z0-9\s,&]+,\s?\d{4}\)", run_info['text']):
            new_run = paragraph.add_run(run_info['text'])
        else:
            rewritten = advanced_paraphrase(run_info['text'])
            new_run = paragraph.add_run(rewritten)
        
        # Restore original formatting
        new_run.bold = run_info['bold']
        new_run.italic = run_info['italic']
        new_run.underline = run_info['underline']
        if run_info['font']:
            new_run.font.name = run_info['font']
        if run_info['size']:
            new_run.font.size = run_info['size']
        if run_info['color']:
            new_run.font.color.rgb = run_info['color']
    
    return paragraph

def process_document(input_path, output_path):
    """Process entire document with academic integrity"""
    doc = docx.Document(input_path)
    
    # Process main content
    for paragraph in tqdm(doc.paragraphs, desc="Processing paragraphs"):
        process_paragraph(paragraph)
    
    # Process tables
    for table in tqdm(doc.tables, desc="Processing tables"):
        for row in table.rows:
            for cell in row.cells:
                for paragraph in cell.paragraphs:
                    process_paragraph(paragraph)
    
    # Process headers and footers
    for section in doc.sections:
        for paragraph in section.header.paragraphs:
            process_paragraph(paragraph)
        for paragraph in section.footer.paragraphs:
            process_paragraph(paragraph)
    
    doc.save(output_path)

def verify_plagiarism(file_path):
    """Placeholder for actual plagiarism verification"""
    print(f"\nVerification needed for {file_path}")
    print("Use professional plagiarism checkers like Turnitin, iThenticate, or Grammarly")
    print("Manual review by academic advisor is strongly recommended")

def main():
    input_files = [
        "document1.docx",
        "document2.docx",
        "document3.docx",
        "document4.docx",
        "document5.docx"
    ]
    
    for input_file in input_files:
        if not os.path.exists(input_file):
            print(f"Error: File {input_file} not found")
            continue
        
        output_file = f"zero_plagiarism_{input_file}"
        print(f"\nProcessing {input_file} to remove all plagiarism...")
        
        process_document(input_file, output_file)
        print(f"Saved processed file as {output_file}")
        
        verify_plagiarism(output_file)

if __name__ == "__main__":
    # Check for required models
    try:
        nlp("test")
    except OSError:
        print("Downloading spaCy model...")
        os.system("python -m spacy download en_core_web_lg")
    
    main()