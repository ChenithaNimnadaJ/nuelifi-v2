from PIL import Image

source = Image.open("public/neulifi-logo.png").convert("RGBA")
source.resize((192, 192), Image.Resampling.LANCZOS).save("public/neulifi-logo-192.png", optimize=True)
