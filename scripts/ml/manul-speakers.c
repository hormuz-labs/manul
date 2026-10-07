// SPDX-License-Identifier: GPL-3.0-or-later (it is linked with sherpa-onnx's libraries, which include espeak-ng; see
// LICENSES/GPL-3.0.txt)
// manul-speakers: who speaks when, as JSON on stdout, for Manul's speakers tool.
// sherpa-onnx's offline speaker diarization (pyannote segmentation + a speaker-embedding model, then clustering),
// statically linked by scripts/build-ml.sh. Reads 16 kHz mono 16-bit WAV (Manul's ffmpeg makes it).
//   manul-speakers --segmentation seg.onnx --embedding emb.onnx [--speakers N] [--threshold 0.5] in.wav
// {"speakers":2,"segments":[[0.32,4.81,0,0.93],…]}   start, end (seconds), speaker (0-based), confidence
// Progress goes to stderr as "progress <done>/<total>" lines.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "sherpa-onnx/c-api/c-api.h"

static int32_t progress(int32_t done, int32_t total, void *arg) {
  (void)arg;
  fprintf(stderr, "progress %d/%d\n", done, total);
  return 0;
}

int main(int argc, char **argv) {
  const char *seg = NULL, *emb = NULL, *wav = NULL;
  int speakers = 0;
  float threshold = 0.5f;
  for (int i = 1; i < argc; i++) {
    if (!strcmp(argv[i], "--segmentation") && i + 1 < argc) seg = argv[++i];
    else if (!strcmp(argv[i], "--embedding") && i + 1 < argc) emb = argv[++i];
    else if (!strcmp(argv[i], "--speakers") && i + 1 < argc) speakers = atoi(argv[++i]);
    else if (!strcmp(argv[i], "--threshold") && i + 1 < argc) threshold = (float)atof(argv[++i]);
    else wav = argv[i];
  }
  if (!seg || !emb || !wav) {
    fprintf(stderr, "usage: manul-speakers --segmentation seg.onnx --embedding emb.onnx [--speakers N] [--threshold 0.5] in.wav\n");
    return 2;
  }

  SherpaOnnxOfflineSpeakerDiarizationConfig config;
  memset(&config, 0, sizeof(config));
  config.segmentation.pyannote.model = seg;
  config.segmentation.num_threads = 2;
  config.segmentation.provider = "cpu";
  config.embedding.model = emb;
  config.embedding.num_threads = 2;
  config.embedding.provider = "cpu";
  config.clustering.num_clusters = speakers > 0 ? speakers : -1;
  config.clustering.threshold = threshold;
  config.clustering.compute_confidence = 1;
  config.min_duration_on = 0.3f;
  config.min_duration_off = 0.5f;

  const SherpaOnnxOfflineSpeakerDiarization *sd = SherpaOnnxCreateOfflineSpeakerDiarization(&config);
  if (!sd) { fprintf(stderr, "manul-speakers: could not load the models\n"); return 1; }
  const SherpaOnnxWave *wave = SherpaOnnxReadWave(wav);
  if (!wave) { fprintf(stderr, "manul-speakers: cannot read %s\n", wav); return 1; }
  int32_t want = SherpaOnnxOfflineSpeakerDiarizationGetSampleRate(sd);
  if (wave->sample_rate != want) {
    fprintf(stderr, "manul-speakers: %s is %d Hz; it must be %d Hz\n", wav, wave->sample_rate, want);
    return 1;
  }

  const SherpaOnnxOfflineSpeakerDiarizationResult *r =
      SherpaOnnxOfflineSpeakerDiarizationProcessWithCallback(sd, wave->samples, wave->num_samples, progress, NULL);
  if (!r) { fprintf(stderr, "manul-speakers: diarization failed\n"); return 1; }
  int32_t n = SherpaOnnxOfflineSpeakerDiarizationResultGetNumSegments(r);
  const SherpaOnnxOfflineSpeakerDiarizationSegment *s = SherpaOnnxOfflineSpeakerDiarizationResultSortByStartTime(r);

  printf("{\"speakers\":%d,\"duration\":%.3f,\"segments\":[", SherpaOnnxOfflineSpeakerDiarizationResultGetNumSpeakers(r),
         (double)wave->num_samples / wave->sample_rate);
  for (int32_t i = 0; i < n; i++)
    printf("%s[%.3f,%.3f,%d,%.3f]", i ? "," : "", s[i].start, s[i].end, s[i].speaker, s[i].confidence);
  printf("]}\n");

  SherpaOnnxOfflineSpeakerDiarizationDestroySegment(s);
  SherpaOnnxOfflineSpeakerDiarizationDestroyResult(r);
  SherpaOnnxFreeWave(wave);
  SherpaOnnxDestroyOfflineSpeakerDiarization(sd);
  return 0;
}
