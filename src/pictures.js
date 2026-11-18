const gifLimit = 3_000_000;
const gifMaxDimension = 4096;
const formats = '.png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif';
const signatures = {
  'image/png': /^89504e470d0a1a0a/,
  'image/jpeg': /^ffd8ff/,
  'image/webp': /^52494646.{8}57454250$/,
  'image/gif': /^474946383[79]61/,
};

export function pictureField(label, name, hint) {
  const note = `${hint} · GIFs up to ${gifLimit / 1_000_000} MB`;
  return `<div class="picture-field" data-picture="${name}"><div><strong>${label}</strong><small>${note}</small></div>
    <label class="button outline choose-picture">Upload<input class="visually-hidden" type="file" accept="${formats}" aria-label="Upload ${label.toLowerCase()}"></label>
    <button type="button" class="button subtle" data-remove hidden>Remove</button><small class="picture-error" role="alert" hidden></small></div>`;
}

export function bindPicture(form, name, initial, size, limit, preview, fit = 'cover') {
  const field = form.querySelector(`[data-picture="${name}"]`);
  const input = field.querySelector('input');
  const remove = field.querySelector('[data-remove]');
  const error = field.querySelector('.picture-error');
  let value;
  let generation = 0;
  let pending;

  function paint() {
    const source = value === undefined ? initial : value;
    remove.hidden = !source;
    preview(source);
  }
  paint();

  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    const version = ++generation;
    error.hidden = true;
    input.value = '';
    pending = preparePicture(file, size, limit, fit).then(result => {
      if (version !== generation) return;
      value = result;
      paint();
    }).catch(failure => {
      if (version !== generation) return;
      error.textContent = failure.message;
      error.hidden = false;
    });
  });
  remove.addEventListener('click', () => {
    generation++;
    error.hidden = true;
    value = initial ? null : undefined;
    paint();
    input.focus();
  });
  return async () => {
    await pending;
    if (!error.hidden) throw new Error(error.textContent);
    return value;
  };
}

async function preparePicture(file, [width, height], limit, fit) {
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const prefix = Array.from(header, byte => byte.toString(16).padStart(2, '0')).join('');
  const type = Object.keys(signatures).find(format => signatures[format].test(prefix));
  if (!type) throw new Error('Choose a PNG, JPEG, WebP, or GIF file.');
  const isGif = type === 'image/gif';
  if (file.size > (isGif ? gifLimit : 10_000_000)) throw new Error(isGif ? 'Choose a GIF of 3 MB or less.' : 'Choose an image of 10 MB or less.');
  const source = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('This picture could not be read.'));
    reader.readAsDataURL(file.type === type ? file : file.slice(0, file.size, type));
  });
  const image = new Image();
  image.src = source;
  try {
    await image.decode();
  } catch {
    throw new Error('This picture could not be read.');
  }
  if (isGif) {
    if (Math.max(image.naturalWidth, image.naturalHeight) > gifMaxDimension) throw new Error('Choose a GIF no wider or taller than 4096 pixels.');
    return source;
  }
  const canvas = document.createElement('canvas');
  const fitWidth = width / image.naturalWidth;
  const fitHeight = height / image.naturalHeight;
  const scale = fit === 'contain' ? Math.min(1, fitWidth, fitHeight) : Math.max(fitWidth, fitHeight);
  const scaledWidth = image.naturalWidth * scale;
  const scaledHeight = image.naturalHeight * scale;
  canvas.width = fit === 'contain' ? Math.max(1, Math.round(scaledWidth)) : width;
  canvas.height = fit === 'contain' ? Math.max(1, Math.round(scaledHeight)) : height;
  const context = canvas.getContext('2d');
  context.drawImage(image, (canvas.width - scaledWidth) / 2, (canvas.height - scaledHeight) / 2, scaledWidth, scaledHeight);
  const result = canvas.toDataURL('image/webp', 0.86);
  if (result.length <= Math.ceil(limit / 3) * 4) return result;
  const fallback = canvas.toDataURL('image/jpeg', 0.8);
  if (fallback.length <= Math.ceil(limit / 3) * 4) return fallback;
  throw new Error('This picture is too large after resizing. Choose another image.');
}
