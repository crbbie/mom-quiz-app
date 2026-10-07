from PIL import Image, ImageDraw

def make(size, path):
    img = Image.new('RGB', (size, size), '#1e6fd9')
    d = ImageDraw.Draw(img)
    m = size // 6
    d.rounded_rectangle([m, m, size - m, size - m], radius=size // 8, fill='white')
    # book glyph: simple open-book shape
    bw, bh = size * 0.44, size * 0.34
    x0, y0 = (size - bw) / 2, (size - bh) / 2
    d.rectangle([x0, y0, x0 + bw, y0 + bh], fill='#1e6fd9')
    d.rectangle([x0 + bw * 0.12, y0 + bh * 0.18, x0 + bw * 0.44, y0 + bh * 0.30], fill='white')
    d.rectangle([x0 + bw * 0.56, y0 + bh * 0.18, x0 + bw * 0.88, y0 + bh * 0.30], fill='white')
    d.rectangle([x0 + bw * 0.12, y0 + bh * 0.42, x0 + bw * 0.44, y0 + bh * 0.54], fill='white')
    d.rectangle([x0 + bw * 0.56, y0 + bh * 0.42, x0 + bw * 0.88, y0 + bh * 0.54], fill='white')
    d.rectangle([x0 + bw * 0.12, y0 + bh * 0.66, x0 + bw * 0.88, y0 + bh * 0.78], fill='white')
    img.save(path)
    print('wrote', path)

make(180, 'icons/apple-touch-icon.png')
make(192, 'icons/icon-192.png')
make(512, 'icons/icon-512.png')
