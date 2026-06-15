#!/usr/bin/env python3
"""Generate image using Gemini API with custom prompt"""

import os
import argparse
from dotenv import load_dotenv
from google import genai
from google.genai.types import GenerateContentConfig

# Load environment variables
load_dotenv()


def generate_image(prompt: str, output_path: str = "generated_image.png") -> str | None:
    """Generate an image from a text prompt using Gemini API
    
    Args:
        prompt: Text description of the image to generate
        output_path: Path where the image will be saved
        
    Returns:
        The path to the saved image, or None if generation failed
    """
    
    try:
        client = genai.Client(api_key=os.getenv('GEMINI_API_KEY'))
        response = client.models.generate_content(
            model='gemini-3.1-flash-image',
            contents=prompt,
            config=GenerateContentConfig(
                response_modalities=['IMAGE', 'TEXT']
            )
        )
        
        if response.candidates:
            for part in response.candidates[0].content.parts:
                if part.inline_data and part.inline_data.mime_type.startswith('image/'):
                    image_data = part.inline_data.data
                    
                    # Ensure output directory exists
                    output_dir = os.path.dirname(output_path)
                    if output_dir:
                        os.makedirs(output_dir, exist_ok=True)
                    
                    # Save image
                    with open(output_path, 'wb') as f:
                        f.write(image_data)
                    
                    print(f"✅ Image saved to: {output_path}")
                    return output_path
        
        print("❌ No image generated")
        return None
        
    except Exception as e:
        print(f"❌ Error generating image: {e}")
        return None


def main():
    parser = argparse.ArgumentParser(description="Generate image using Gemini API")
    parser.add_argument(
        "prompt",
        type=str,
        help="Text prompt describing the image to generate"
    )
    parser.add_argument(
        "-o", "--output",
        type=str,
        default="generated_image.png",
        help="Output file path (default: generated_image.png)"
    )
    
    args = parser.parse_args()
    
    generate_image(args.prompt, args.output)


if __name__ == '__main__':
    main()
