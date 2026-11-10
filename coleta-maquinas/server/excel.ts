import * as XLSX from '@e965/xlsx';
import {
  CONFIG_MAQUINAS,
  gerarEstruturaDia,
  normalizarDia,
  type DiaColeta,
  type LinhaDesmoldanteExcel,
  type LinhaInjecaoExcel,
} from '../src/domain.js';

const CAMPOS_INJECAO = [
  'Data',
  'Coleta',
  'Horário Registro',
  'Máquina',
  'Posto Nº',
  'Tamanho',
  'T.R. Compacta',
  'T.R. Injetada',
];

const parseNumber = (value: unknown, field: string) => {
  if (value === '' || value === null || value === undefined) return 0;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  if (!Number.isFinite(parsed)) throw new Error(`O campo "${field}" contém um valor inválido.`);
  return parsed;
};

const parseCollectionId = (value: unknown) =>
  Number(String(value ?? '').trim().match(/^([1-4])ª Coleta$/)?.[1]);

export const importarWorkbook = (bytes: Uint8Array, dataEsperada?: string) => {
  const workbook = XLSX.read(bytes, { cellDates: false });
  const injectionSheet =
    workbook.Sheets['Injeção'] ?? workbook.Sheets[workbook.SheetNames[0]];
  if (!injectionSheet) throw new Error('O arquivo não contém uma planilha de injeção.');

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(injectionSheet, {
    defval: '',
  });
  if (rows.length === 0 || !CAMPOS_INJECAO.every((field) => field in rows[0])) {
    throw new Error('Formato inválido. Use um arquivo diário exportado pelo sistema.');
  }

  const date = String(rows[0].Data ?? '');
  if (dataEsperada && date !== dataEsperada) {
    throw new Error('A data do arquivo não corresponde à data solicitada.');
  }
  const day = gerarEstruturaDia(date);
  const importedRows = new Set<string>();

  for (const row of rows) {
    if (String(row.Data ?? '') !== date) {
      throw new Error('O arquivo contém mais de uma data.');
    }
    const collectionId = parseCollectionId(row.Coleta);
    const machineName = String(row.Máquina ?? '').trim();
    const machineConfig = CONFIG_MAQUINAS.find((machine) => machine.nome === machineName);
    if (!collectionId || !machineConfig) {
      throw new Error('O arquivo contém uma coleta ou máquina não reconhecida.');
    }
    const postNumber = parseNumber(row['Posto Nº'], 'Posto Nº');
    if (
      !Number.isInteger(postNumber) ||
      postNumber < 1 ||
      postNumber > machineConfig.totalPostos
    ) {
      throw new Error(`Posto inválido para ${machineName}.`);
    }
    const rowKey = `${collectionId}:${machineConfig.id}:${postNumber}`;
    if (importedRows.has(rowKey)) throw new Error('O arquivo contém postos duplicados.');
    importedRows.add(rowKey);

    const machine = day.coletas[collectionId - 1].maquinas[machineConfig.id - 1];
    const post = machine.postos[postNumber - 1];
    post.tamanho = parseNumber(row.Tamanho, 'Tamanho');
    post.tempoRealCompacta = parseNumber(row['T.R. Compacta'], 'T.R. Compacta');
    post.tempoRealInjetada = parseNumber(row['T.R. Injetada'], 'T.R. Injetada');

    const savedAt = String(row['Horário Registro'] ?? '').trim();
    if (savedAt && savedAt !== 'Pendente') {
      const current = day.coletas[collectionId - 1].horarioSalvamento;
      if (current && current !== savedAt) {
        throw new Error(`A ${collectionId}ª coleta tem horários inconsistentes no arquivo.`);
      }
      day.coletas[collectionId - 1].horarioSalvamento = savedAt;
    }
  }

  const expectedRows =
    CONFIG_MAQUINAS.reduce((total, machine) => total + machine.totalPostos, 0) * 4;
  if (importedRows.size !== expectedRows) {
    throw new Error('O arquivo está incompleto; precisa conter as quatro coletas e máquinas.');
  }

  const desmoldanteSheet = workbook.Sheets['Desmoldante'];
  if (desmoldanteSheet) {
    const consumptionRows =
      XLSX.utils.sheet_to_json<Record<string, unknown>>(desmoldanteSheet, { defval: '' });
    const importedConsumption = new Set<string>();

    for (const row of consumptionRows) {
      if (String(row.Data ?? '') !== date) {
        throw new Error('A planilha de desmoldante contém uma data diferente do arquivo.');
      }
      const collectionId = parseCollectionId(row.Coleta);
      const machineConfig = CONFIG_MAQUINAS.find(
        (machine) => machine.nome === String(row.Máquina ?? '').trim()
      );
      if (!collectionId || !machineConfig) {
        throw new Error('A planilha de desmoldante contém coleta ou máquina inválida.');
      }
      const key = `${collectionId}:${machineConfig.id}`;
      if (importedConsumption.has(key)) {
        throw new Error('A planilha de desmoldante contém medições duplicadas.');
      }
      importedConsumption.add(key);
      day.coletas[collectionId - 1].maquinas[machineConfig.id - 1].desmoldante = {
        estoqueInicialL: parseNumber(row['Estoque Inicial (L)'], 'Estoque Inicial (L)'),
        reposicaoL: parseNumber(row['Reposição (L)'], 'Reposição (L)'),
        estoqueFinalL: parseNumber(row['Estoque Final (L)'], 'Estoque Final (L)'),
      };
    }
    if (importedConsumption.size !== 16) {
      throw new Error('A planilha de desmoldante deve ter uma linha por coleta e máquina.');
    }
  }

  return normalizarDia(day, dataEsperada);
};

export const exportarWorkbook = (day: DiaColeta) => {
  const injectionRows: LinhaInjecaoExcel[] = [];
  const consumptionRows: LinhaDesmoldanteExcel[] = [];

  for (const collection of day.coletas) {
    for (const machine of collection.maquinas) {
      for (const post of machine.postos) {
        injectionRows.push({
          Data: day.data,
          Setor: 'Desma',
          Coleta: `${collection.idColeta}ª Coleta`,
          'Horário Registro': collection.horarioSalvamento ?? 'Pendente',
          Máquina: machine.nomeMaquina,
          'Posto Nº': post.numeracaoPosto,
          Tamanho: post.tamanho,
          'T.R. Compacta': post.tempoRealCompacta,
          'T.R. Injetada': post.tempoRealInjetada,
        });
      }
      const consumption = machine.desmoldante;
      consumptionRows.push({
        Data: day.data,
        Coleta: `${collection.idColeta}ª Coleta`,
        Máquina: machine.nomeMaquina,
        'Estoque Inicial (L)': consumption.estoqueInicialL,
        'Reposição (L)': consumption.reposicaoL,
        'Estoque Final (L)': consumption.estoqueFinalL,
        'Consumo (L)': Math.round(
          (consumption.estoqueInicialL +
            consumption.reposicaoL -
            consumption.estoqueFinalL +
            Number.EPSILON) *
            1000
        ) / 1000,
      });
    }
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(injectionRows),
    'Injeção'
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(consumptionRows),
    'Desmoldante'
  );
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};
