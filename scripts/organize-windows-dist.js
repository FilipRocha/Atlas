const { copyFile, mkdir, rename, rm, stat, writeFile } = require('node:fs/promises')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const dist = path.join(root, 'dist')
const version = require(path.join(root, 'package.json')).version

const groups = [
  {
    folder: 'Instalador',
    readme:
      'INSTALADOR DO ATLAS\n\nAbra Atlas-Setup para instalar o Atlas no Windows. O Windows pedirá permissão de administrador.\n',
    files: [`Atlas-Setup-${version}.exe`, `Atlas-Setup-${version}.exe.blockmap`]
  },
  {
    folder: 'Portátil',
    readme:
      'ATLAS PORTÁTIL\n\nO arquivo EXE inicia o Atlas sem instalação, mas pode pedir permissão de administrador.\n\nO ZIP contém a pasta completa: extraia todos os arquivos e abra Atlas.exe. O Windows também pode pedir permissão de administrador.\n',
    files: [`Atlas-Portable-${version}.exe`, `Atlas-Portable-${version}-x64.zip`]
  }
]

async function exists(file) {
  try {
    return (await stat(file)).isFile()
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

async function organize() {
  // Check all files first so a partial build cannot leave dist half-organized.
  for (const group of groups) {
    const directory = path.join(dist, group.folder)
    for (const name of group.files) {
      const source = path.join(dist, name)
      const destination = path.join(directory, name)
      if (!(await exists(source)) && !(await exists(destination))) {
        throw new Error(`Artefato do Windows ausente: ${name}`)
      }
    }
  }

  for (const group of groups) {
    const directory = path.join(dist, group.folder)
    await mkdir(directory, { recursive: true })
    for (const name of group.files) {
      const source = path.join(dist, name)
      const destination = path.join(directory, name)
      if (await exists(source)) {
        await rm(destination, { force: true })
        try {
          await rename(source, destination)
        } catch (error) {
          if (!['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error
          await copyFile(source, destination)
          const [sourceInfo, destinationInfo] = await Promise.all([stat(source), stat(destination)])
          if (sourceInfo.size !== destinationInfo.size) {
            throw new Error(`Cópia incompleta do artefato: ${name}`)
          }
          try {
            await rm(source)
          } catch (removeError) {
            if (!['EBUSY', 'EPERM', 'EACCES'].includes(removeError.code)) throw removeError
            console.warn(`O arquivo original segue bloqueado no dist: ${name}`)
          }
        }
      }
    }
    await writeFile(path.join(directory, 'LEIA-ME.txt'), group.readme, 'utf8')
  }

  // Keep the distributable folder focused on the installer and portable packages.
  await rm(path.join(dist, 'win-unpacked'), { recursive: true, force: true })
  await rm(path.join(dist, 'builder-debug.yml'), { force: true })

  console.log('Distribuição organizada em dist/Instalador e dist/Portátil.')
}

organize().catch((error) => {
  console.error(`Falha ao organizar a distribuição: ${error.message}`)
  process.exitCode = 1
})
