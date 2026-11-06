// 브라우저에서 직인 이미지 파일을 작은 PNG data URL로 바꾼다(캔버스 사용). 서버 검증 기준은 src/lib/seal-image.ts.
import { fitWithin, MAX_SEAL_CHARS, MAX_SEAL_SOURCE_BYTES, SEAL_SIDE_STEPS } from '@/lib/seal-image';

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지를 읽을 수 없습니다. PNG·JPG 파일인지 확인해주세요.'));
    };
    img.src = url;
  });
}

// 긴 변을 256px → 192px → 128px 순으로 줄여 가며 상한(MAX_SEAL_CHARS) 안에 들어가는 PNG를 만든다. 투명 배경은 그대로 둔다.
export async function sealFileToDataUrl(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('PNG, JPG, WEBP 이미지만 올릴 수 있습니다.');
  if (file.size > MAX_SEAL_SOURCE_BYTES) throw new Error('파일이 너무 큽니다(10MB 이하).');
  const img = await loadImage(file);
  if (!img.naturalWidth || !img.naturalHeight) throw new Error('이미지를 읽을 수 없습니다.');
  for (const side of SEAL_SIDE_STEPS) {
    const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight, side);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('이 브라우저에서는 이미지를 줄일 수 없습니다.');
    ctx.drawImage(img, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/png');
    if (dataUrl.length <= MAX_SEAL_CHARS) return dataUrl;
  }
  throw new Error('이미지가 너무 복잡해서 줄여도 용량 상한을 넘습니다. 단순한 도장 이미지를 올려주세요.');
}
