import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '');
  
  if (token !== process.env.INTERNAL_API_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const productos = await req.json();
    
    if (!Array.isArray(productos) || productos.length === 0) {
      return NextResponse.json({ error: 'Array vacío' }, { status: 400 });
    }

    const tipoProveedor = productos[0]?.tipo_proveedor;
    const tabla = tipoProveedor === 'mayorista' 
      ? 'mekk_productos_mayorista' 
      : 'mekk_productos_minorista';

    const rows = productos.map((p: any) => {
      const base = {
        nombre: p.nombre,
        categoria: p.categoria,
        link: p.link,
        imagen_url: p.imagen_url,
        activo: true,
        updated_at: new Date().toISOString(),
      };
      if (tipoProveedor === 'mayorista') {
        return { ...base, precio_mayorista: p.precio_mayorista };
      } else {
        return { ...base, precio_minorista: p.precio_minorista };
      }
    });

    const { data, error } = await supabase
      .from(tabla)
      .upsert(rows, { onConflict: 'nombre' })
      .select('id');

    if (error) {
      console.error('Error upsert', error);
      return NextResponse.json({ error: error.message, errores: rows.length, upserts: 0 }, { status: 500 });
    }

    return NextResponse.json({ 
      upserts: data?.length ?? 0, 
      errores: 0,
      tabla 
    });

  } catch (err: any) {
    console.error('Error general', err);
    return NextResponse.json({ error: err.message, errores: 0, upserts: 0 }, { status: 500 });
  }
}

export const maxDuration = 60;
