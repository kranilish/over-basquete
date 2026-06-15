# Over Basquete — servidor local com busca Sofascore

Este projeto abre um servidor local e permite colar um link/ID de jogo do Sofascore.
O servidor tenta buscar o placar por quartos e preencher a planilha automaticamente.

## Como rodar

1. Instale o Node.js:
   https://nodejs.org

2. Abra o terminal/CMD dentro desta pasta.

3. Rode:

```bash
npm install
npm start
```

4. Abra no navegador:

```text
http://localhost:3000
```

## Como usar

1. Abra o jogo no Sofascore.
2. Copie o link do jogo.
3. Cole no campo do app.
4. Clique em "Buscar dados".

Se o link não tiver o ID visível, tente copiar o link completo pelo botão compartilhar do Sofascore.
Alguns links usam algo parecido com:

```text
https://www.sofascore.com/...#id:12345678
```

Também é possível colar apenas o número do ID.

## Observação importante

O Sofascore não oferece uma API pública oficial simples para esse uso.
Este projeto usa endpoint não oficial do próprio site, então pode parar se o Sofascore mudar o formato.
Para algo mais profissional/estável, use uma API paga ou Apify.