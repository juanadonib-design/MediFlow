/**
 * POST /api/ingest/file — Ingiere un documento clínico en PDF o IMAGEN.
 * multipart/form-data con campos: archivo (File), canal_origen (opcional).
 *
 * Usa el runtime Node.js de Vercel (no Edge) porque necesitamos Buffer y
 * escritura a /tmp para el stub de persistencia.
 */
import { NextResponse } from "next/server";

import { generarDocumentoId, ResultadoIngesta } from "@/lib/types";
import { persistirEnOciStub } from "@/lib/storage";
import {
  ArchivoDemasiadoGrandeError,
  ArchivoInconsistenteError,
  FormatoNoSoportadoError,
  validarArchivo,
} from "@/lib/validators";

export const runtime = "nodejs";
// Nota: en el plan Hobby de Vercel el body de las funciones serverless
// está limitado a ~4.5 MB; si necesitas subir archivos más grandes,
// sube directo a OCI/S3 desde el cliente con una URL prefirmada en vez
// de pasar por esta función.

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { status: "rechazado", detalle: "No se pudo interpretar el multipart/form-data." },
      { status: 400 },
    );
  }

  const archivo = formData.get("archivo");
  if (!(archivo instanceof File)) {
    return NextResponse.json(
      {
        status: "rechazado",
        detalle: "Falta el campo 'archivo' (PDF o IMAGEN) en el form-data.",
        formatos_soportados: ["PDF", "IMAGEN", "JSON", "TEXTO"],
      },
      { status: 422 },
    );
  }

  const canalOrigen = (formData.get("canal_origen") as string | null) ?? "Otro";
  const contenido = new Uint8Array(await archivo.arrayBuffer());

  try {
    const { tipoDetectado, tamanoBytes } = validarArchivo(
      archivo.name,
      archivo.type,
      contenido,
    );

    const documentoId = generarDocumentoId();
    const nombreGuardado = `${documentoId}_${archivo.name}`;
    const rutaObjeto = await persistirEnOciStub(nombreGuardado, contenido);

    const resultado: ResultadoIngesta = {
      status: "recibido",
      documento_id: documentoId,
      tipo_archivo_detectado: tipoDetectado,
      tamano_bytes: tamanoBytes,
      canal_origen: canalOrigen as ResultadoIngesta["canal_origen"],
      recibido_en: new Date().toISOString(),
      ruta_objeto_temporal: rutaObjeto,
    };

    return NextResponse.json(resultado, { status: 201 });
  } catch (error) {
    if (error instanceof FormatoNoSoportadoError) {
      return NextResponse.json(
        {
          status: "rechazado",
          detalle: error.message,
          formatos_soportados: ["PDF", "IMAGEN", "JSON", "TEXTO"],
        },
        { status: 415 },
      );
    }
    if (error instanceof ArchivoInconsistenteError) {
      return NextResponse.json(
        { status: "rechazado", detalle: error.message },
        { status: 422 },
      );
    }
    if (error instanceof ArchivoDemasiadoGrandeError) {
      return NextResponse.json(
        { status: "rechazado", detalle: error.message },
        { status: 413 },
      );
    }
    console.error("Error inesperado en /api/ingest/file:", error);
    return NextResponse.json(
      { status: "rechazado", detalle: "Error interno al procesar el archivo." },
      { status: 500 },
    );
  }
}
