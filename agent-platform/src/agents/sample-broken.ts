/** Fake Builder 的第一版产物：故意抛错，用于演示"硬验证失败→回灌修复"闭环。 */
export const SAMPLE_BROKEN_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>broken</title>
</head>
<body>
<canvas id="c" width="480" height="360"></canvas>
<script>
throw new Error("boom: game.init is not a function");
</script>
</body>
</html>`;
